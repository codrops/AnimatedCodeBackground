import { glsl, CodeField } from '../codeField.js';

// Variation 4, typeset: around the pointer, faint loose characters drift out
// of place, tilted; near it they spring into line, upright and bright, and
// loosen again once it has passed

// Each cell's order: 0 is loose, 1 is in line. A damped spring pulls it
// towards 1 near the pointer and back to 0 elsewhere, overshooting a little
const orderShader = `#version 300 es
precision highp float;

out vec4 fragColor;

// r: order, g: its velocity, b: how much the cell's character flickers
uniform sampler2D uOrder;
// one cell's size, in uv
uniform vec2 uCellUv;
uniform vec2 uPointer;
// 1 while the pointer is over the card
uniform float uHover;
// how close to the pointer characters fall into line, in uv
uniform float uRadius;
uniform float uStiffness;
uniform float uDamping;
uniform float uDt;

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 state = texelFetch(uOrder, cell, 0);

    // The cell's center (cells count from the top)
    vec2 uv = vec2((float(cell.x) + 0.5) * uCellUv.x, 1.0 - (float(cell.y) + 0.5) * uCellUv.y);
    float d = distance(uv, uPointer);
    float target = uHover * smoothstep(uRadius, uRadius * 0.3, d);

    // The spring
    float acceleration = uStiffness * (target - state.r) - uDamping * state.g;
    state.g += acceleration * uDt;
    state.r += state.g * uDt;

    // Loose characters close to the pointer flicker; ones in line are still
    state.b = uHover * (1.0 - clamp(state.r, 0.0, 1.0)) * smoothstep(uRadius * 2.0, uRadius, d);

    fragColor = state;
}`;

// Each cell's pose: how far its character has drifted (in cells) and how much 
// it's turned, from how loose it is. Worked out once per cell, not per pixel
const poseShader = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uOrder;
uniform float uTime;

${glsl.noise}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    float order = texelFetch(uOrder, cell, 0).r;
    // past 1 the spring overshoots, and the character sways the other way
    float loose = 1.0 - order;

    // A slow drift that neighbouring characters share, so they move in waves
    vec2 p = vec2(cell) * 0.31 + vec2(uTime * 0.12, -uTime * 0.07);
    vec2 offset = (vec2(noise(p), noise(p + 17.3)) * 2.0 - 1.0) * vec2(0.9, 0.55) * loose;
    float angle = (noise(p + 41.7) * 2.0 - 1.0) * 0.5 * loose;

    fragColor = vec4(offset, angle, order);
}`;

// Each character, moved and turned by its pose
const displayShader = `#version 300 es
precision highp float;

out vec4 fragColor;

// xy: offset in cells, z: angle, w: order
uniform sampler2D uPose;
uniform vec2 uPointer;
// how far the faint loose characters reach, in uv
uniform float uHaze;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

mat2 rotation(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, s, -s, c);
}

void main() {
    vec2 px = pixel();
    vec2 base = floor(px / uCellSize);

    // Loose characters can drift into the neighbouring cells,
    // so look at the 3x3 cells around this pixel and keep the strongest
    float alpha = 0.0;
    vec3 color = vec3(0.0);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 cell = base + vec2(i, j);
            if ( any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, uCells)) ) continue;

            vec4 pose = texelFetch(uPose, ivec2(cell), 0);
            float order = pose.w;

            // This pixel in the character's own, turned cell
            mat2 turn = rotation(-pose.z);
            vec2 center = (cell + 0.5 + pose.xy) * uCellSize;
            vec2 q = turn * (px - center) / uCellSize + 0.5;
            float coverage = glyph(glyphIndex(cell), q, turn * vec2(1.0, 0.0), turn * vec2(0.0, 1.0));

            // In line, bright; loose, a faint haze that fades with distance
            float inLine = clamp(order, 0.0, 1.0);
            float faint = 0.22 * smoothstep(uHaze, 0.0, distance(cellUv(cell), uPointer));
            float a = coverage * mix(faint, 1.0, inLine) * uPresence;
            if ( a > alpha ) {
                alpha = a;
                color = palette(0.3 + inLine * 1.0);
            }
        }
    }

    fragColor = vec4(color * alpha, alpha);
}`;

export class TypesetField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // how close to the pointer characters fall into line, and how far
        // the faint loose ones reach, in parts of the card
        radius: 0.22,
        haze: 0.6,
        // the spring: stiff enough to snap, damped enough to settle after a small sway
        stiffness: 90,
        damping: 11,
        linger: 0.3,
        fadeOut: 0.8,
        tapHold: 1.2
    };
    // each cell's order, and its character's pose
    order;
    pose;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('order', orderShader);
        this.program('pose', poseShader);
        this.program('display', displayShader);
    }

    // One order texel per character cell
    resized() {
        if ( this.order && this.order.read.width === this.cells.x && this.order.read.height === this.cells.y ) return;
        if ( this.order ) {
            this.deleteTarget(this.order);
            this.deleteTarget(this.pose);
        }
        const options = {
            internalFormat: this.gl.RGBA16F,
            format: this.gl.RGBA,
            type: this.gl.HALF_FLOAT,
            filter: this.gl.NEAREST
        };
        this.order = this.createDoubleTarget(this.cells.x, this.cells.y, options);
        this.pose = this.createTarget(this.cells.x, this.cells.y, options);
    }

    render({ dt, time, pointer, isHovered, presence }) {
        const settings = TypesetField.settings;

        this.pass('order', this.order.write, {
            uOrder: this.order.read.texture,
            uCellUv: [this.atlas.cellWidth / this.canvas.width, this.atlas.cellHeight / this.canvas.height],
            uPointer: pointer,
            uHover: isHovered ? 1 : 0,
            uRadius: settings.radius,
            uStiffness: settings.stiffness,
            uDamping: settings.damping,
            uDt: dt
        });
        this.order.swap();

        // Loose characters near the pointer flicker, a few changes a second
        this.reroll({ activity: this.order.read.texture, channel: [0, 0, 1, 0], rate: 6, range: [0.2, 1], dt, time });

        this.pass('pose', this.pose, {
            uOrder: this.order.read.texture,
            uTime: time
        });

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uPose: this.pose.texture,
            uPointer: pointer,
            uHaze: settings.haze,
            uPresence: presence
        });
    }

    reset() {
        this.clearTarget(this.order);
        super.reset();
    }
}
