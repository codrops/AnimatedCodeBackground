import { glsl, CodeField } from '../codeField.js';

// Variation 8, knockout: the pointer flips the code into solid blocks of colour
// with the characters cut out of them, reversed type that trails behind it and
// flips back, cell by cell, once it has passed

// Each cell's charge, and how far it has flipped
const stateShader = `#version 300 es
precision highp float;

out vec4 fragColor;

// r: charge, g: how far the cell has flipped (0 to 1), b: how much it scrambles
uniform sampler2D uState;
// one cell's size, in uv
uniform vec2 uCellUv;
uniform vec2 uPointer;
// 1 while the pointer is over the card
uniform float uHover;
// how close to the pointer cells charge, in uv
uniform float uRadius;
// how quickly they charge near the pointer, wear off elsewhere, and flip
uniform float uRise;
uniform float uDecay;
uniform float uFlipSpeed;
uniform float uDt;

${glsl.noise}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 state = texelFetch(uState, cell, 0);

    // The cell's center (cells count from the top)
    vec2 uv = vec2((float(cell.x) + 0.5) * uCellUv.x, 1.0 - (float(cell.y) + 0.5) * uCellUv.y);
    float near = uHover * smoothstep(uRadius, uRadius * 0.3, distance(uv, uPointer));

    // It charges quickly near the pointer and wears off slowly elsewhere
    float charge = near > state.r
        ? mix(state.r, near, 1.0 - exp(-uRise * uDt))
        : max(state.r - uDecay * uDt, 0.0);

    // Each cell flips at its own threshold, so the edge is ragged,
    // and eases into its new state rather than snapping
    float threshold = 0.2 + 0.7 * hash(vec2(cell) * 2.31 + 1.9);
    float flipped = mix(state.g, step(threshold, charge), 1.0 - exp(-uFlipSpeed * uDt));

    fragColor = vec4(charge, flipped, (1.0 - flipped) * smoothstep(0.05, 0.3, charge), 1.0);
}`;

// Solid blocks with the characters cut out where cells have flipped;
// faint characters around them
const displayShader = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uState;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    vec2 cell = floor(px / uCellSize);
    vec2 inCell = px / uCellSize - cell;

    vec4 state = texelFetch(uState, ivec2(cell), 0);
    float charge = state.r * uPresence;
    float flipped = state.g * uPresence;
    float coverage = glyph(glyphIndex(cell), inCell, vec2(1.0, 0.0), vec2(0.0, 1.0));

    // A flipped cell is a block of colour with its character cut out
    float block = flipped * (1.0 - coverage);
    // An unflipped one shows its character, faintly
    float text = (1.0 - flipped) * coverage * smoothstep(0.03, 0.3, charge) * 0.7;

    vec3 color = palette(0.3 + charge * 0.95) * block + palette(0.15 + charge * 0.5) * text;
    fragColor = vec4(color, block + text);
}`;

export class KnockoutField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // how close to the pointer cells charge, in parts of the card
        radius: 0.2,
        // how quickly they charge, wear off (per second) and flip
        rise: 6,
        decay: 0.45,
        flipSpeed: 14,
        // after the pointer leaves, the blocks flip back on their own; then what's left fades
        linger: 2,
        fadeOut: 0.8,
        tapHold: 1
    };
    // each cell's state
    state;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('state', stateShader);
        this.program('display', displayShader);
    }

    // One state texel per cell
    resized() {
        const { gl, cells } = this;
        if ( this.state && this.state.read.width === cells.x && this.state.read.height === cells.y ) return;
        if ( this.state ) {
            this.deleteTarget(this.state);
        }
        this.state = this.createDoubleTarget(cells.x, cells.y, {
            internalFormat: gl.RGBA16F,
            format: gl.RGBA,
            type: gl.HALF_FLOAT,
            filter: gl.NEAREST
        });
    }

    render({ dt, time, pointer, isHovered, presence }) {
        const settings = KnockoutField.settings;

        this.pass('state', this.state.write, {
            uState: this.state.read.texture,
            uCellUv: [this.atlas.cellWidth / this.canvas.width, this.atlas.cellHeight / this.canvas.height],
            uPointer: pointer,
            uHover: isHovered ? 1 : 0,
            uRadius: settings.radius,
            uRise: settings.rise,
            uDecay: settings.decay,
            uFlipSpeed: settings.flipSpeed,
            uDt: dt
        });
        this.state.swap();

        // Charged cells that haven't flipped yet flicker
        this.reroll({ activity: this.state.read.texture, channel: [0, 0, 1, 0], rate: 8, range: [0.05, 0.6], dt, time });

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uState: this.state.read.texture,
            uPresence: presence
        });
    }

    reset() {
        this.clearTarget(this.state);
        super.reset();
    }
}
