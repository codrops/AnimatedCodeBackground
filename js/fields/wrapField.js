import { glsl, CodeField } from '../codeField.js';

// Variation 6, wrap: the code reflows around the pointer like text wrapping
// around a round shape. Each line breaks at the circle and carries on past
// it; the circle opens and closes with a little spring

// The most rows a card can have (the shader's array is this long)
const MAX_ROWS = 64;

const displayShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

// each row's gap: halfWidth its width, in cells, around the center column
uniform float uGaps[${MAX_ROWS}];
uniform float uGapCenter;
// the circle's radius, and the window's center and reach, in uv
uniform float uRadius;
uniform vec2 uWindow;
uniform float uReach;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    float row = floor(px.y / uCellSize.y);
    float y = px.y / uCellSize.y - row;
    float x = px.x / uCellSize.x;

    // Where this row's gap starts and ends, in cells
    float halfWidth = uGaps[int(min(row, ${MAX_ROWS - 1}.0))];
    float start = uGapCenter - halfWidth;
    float end = uGapCenter + halfWidth;

    float coverage = 0.0;
    if ( halfWidth <= 0.0 || x < start ) {
        // Before the gap the line is as it was; the character the gap's
        // edge passes through fades with how much of it is left
        float column = floor(x);
        float visible = halfWidth <= 0.0 ? 1.0 : clamp(start - column, 0.0, 1.0);
        coverage = glyph(glyphIndex(vec2(column, row)), vec2(x - column, y), vec2(1.0, 0.0), vec2(0.0, 1.0)) * visible;
    }
    else if ( x >= end ) {
        // After it, the line carries on from the first character the gap hid
        float shifted = x - end + floor(start);
        float column = floor(shifted);
        coverage = glyph(glyphIndex(vec2(column, row)), vec2(shifted - column, y), vec2(1.0, 0.0), vec2(0.0, 1.0));
    }

    // Shown in a soft window around the pointer, brightest along the circle's rim
    float d = distance(vUv, uWindow);
    float reveal = smoothstep(uReach, uReach * 0.15, d) * uPresence;
    float rim = 1.0 - smoothstep(uRadius, uRadius + 0.25, d);
    float alpha = coverage * reveal;

    fragColor = vec4(palette(0.2 + rim * 1.1) * alpha, alpha);
}`;

export class WrapField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // the circle's radius, in parts of the card
        radius: 0.14,
        // the spring that opens and closes each line's gap
        stiffness: 110,
        damping: 12,
        // the window: how quickly it follows the pointer (per frame at 60fps), and its reach
        follow: 0.12,
        reach: 0.5,
        tapHold: 1.5
    };
    // each row's gap (half its width, in cells) and how fast it's changing
    gaps = [];
    // the circle's center, following the pointer (null until it's first shown)
    center = null;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('display', displayShader);
    }

    // One gap per line of cells
    resized() {
        const count = Math.min(this.cells.y, MAX_ROWS);
        while ( this.gaps.length < count ) {
            this.gaps.push({ half: 0, velocity: 0 });
        }
        this.gaps.length = count;
    }

    render({ dt, pointer, hasEntered, isHovered, presence }) {
        const settings = WrapField.settings;
        const amount = 1 - Math.pow(1 - settings.follow, gsap.ticker.deltaRatio());

        // The circle eases towards the pointer (it starts there when the pointer comes in)
        if ( !this.center || hasEntered ) {
            this.center = {...pointer};
        }
        this.center.x = gsap.utils.interpolate(this.center.x, pointer.x, amount);
        this.center.y = gsap.utils.interpolate(this.center.y, pointer.y, amount);

        // Each row's gap springs towards the circle's width at that row (none when the pointer is away)
        const cellsPerUv = this.canvas.width / this.atlas.cellWidth;
        const rowHeight = this.atlas.cellHeight / this.canvas.height;
        const halves = new Float32Array(MAX_ROWS);
        this.gaps.forEach((gap, i) => {
            const dy = 1 - (i + 0.5) * rowHeight - this.center.y;
            const target = isHovered ? Math.sqrt(Math.max(settings.radius * settings.radius - dy * dy, 0)) * cellsPerUv : 0;
            const acceleration = settings.stiffness * (target - gap.half) - settings.damping * gap.velocity;
            gap.velocity += acceleration * dt;
            gap.half = Math.max(gap.half + gap.velocity * dt, 0);
            halves[i] = gap.half;
        });

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uGaps: halves,
            uGapCenter: this.center.x * cellsPerUv,
            uRadius: settings.radius,
            uWindow: this.center,
            uReach: settings.reach,
            uPresence: presence
        });
    }

    reset() {
        this.center = null;
        this.gaps.forEach(gap => {
            gap.half = 0;
            gap.velocity = 0;
        });
        super.reset();
    }
}
