import { glsl, CodeField } from '../codeField.js';

// Variation 5, stream: every row of code flows sideways at its own speed, like
// a feed of data. Rows near the pointer brake and settle so they can be read,
// and moving the pointer sideways drags them along

// The most rows a card can have (the shader's arrays are this long)
const MAX_ROWS = 64;

// Each row's characters, slid by the row's offset, in a window around the pointer
const displayShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

// each row's offset, in cells, and how calm it is (1 when it's still)
uniform float uOffsets[${MAX_ROWS}];
uniform float uCalm[${MAX_ROWS}];
// the center of the window, following the pointer, and its reach, in uv
uniform vec2 uWindow;
uniform float uReach;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    float row = floor(px.y / uCellSize.y);
    int index = int(min(row, ${MAX_ROWS - 1}.0));

    // The row's characters, slid sideways (columns wrap around)
    float x = px.x / uCellSize.x - uOffsets[index];
    float column = floor(x);
    vec2 inCell = vec2(x - column, px.y / uCellSize.y - row);
    float coverage = glyph(glyphIndex(vec2(column, row)), inCell, vec2(1.0, 0.0), vec2(0.0, 1.0));

    // Shown in a soft window around the pointer, like variation 1's;
    // calm rows near the pointer are the brightest
    float reveal = smoothstep(uReach, uReach * 0.15, distance(vUv, uWindow));
    float calm = uCalm[index];
    float alpha = coverage * reveal * mix(0.45, 1.0, calm) * uPresence;

    fragColor = vec4(palette(0.25 + reveal * 0.6 + calm * 0.55) * alpha, alpha);
}`;

export class StreamField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // how fast the rows flow on their own, in cells per second
        minSpeed: 2,
        maxSpeed: 9,
        // how close to the pointer rows are caught, in parts of the card
        catchRadius: 0.16,
        // how quickly a row's speed follows its target, per second
        response: 5,
        // the window: how quickly it follows the pointer (per frame at 60fps), and its reach
        follow: 0.1,
        reach: 0.55,
        fadeOut: 0.8,
        tapHold: 1.5
    };
    // each row's offset (in cells), speed, and own speed when it's free
    rows = [];
    // the pointer's sideways speed, in cells per second, smoothed
    dragSpeed = 0;
    // the window's center, following the pointer (null until it's first shown)
    window = null;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('display', displayShader);
    }

    // One row per line of cells, each with its own speed and direction
    resized() {
        const settings = StreamField.settings;
        const count = Math.min(this.cells.y, MAX_ROWS);
        while ( this.rows.length < count ) {
            const speed = gsap.utils.random(settings.minSpeed, settings.maxSpeed) * gsap.utils.random([-1, 1]);
            this.rows.push({ offset: gsap.utils.random(0, this.cells.x), speed, ownSpeed: speed });
        }
        this.rows.length = count;
    }

    render({ dt, pointer, from, hasEntered, isHovered, presence }) {
        const settings = StreamField.settings;
        const ease = 1 - Math.pow(1 - settings.follow, gsap.ticker.deltaRatio());

        // The window eases towards the pointer (it starts at the pointer when it comes in)
        if ( !this.window || hasEntered ) {
            this.window = {...pointer};
        }
        this.window.x = gsap.utils.interpolate(this.window.x, pointer.x, ease);
        this.window.y = gsap.utils.interpolate(this.window.y, pointer.y, ease);

        // The pointer's sideways speed, in cells per second
        const pointerSpeed = dt ? (pointer.x - from.x) * this.cells.x / dt : 0;
        this.dragSpeed = gsap.utils.interpolate(this.dragSpeed, pointerSpeed, ease);

        // Rows near the pointer take its sideways speed (so they stop when it
        // rests, and follow it when it moves); the others go back to their own
        const response = 1 - Math.exp(-settings.response * dt);
        const rowHeight = this.atlas.cellHeight / this.canvas.height;
        const offsets = new Float32Array(MAX_ROWS);
        const calm = new Float32Array(MAX_ROWS);
        this.rows.forEach((row, i) => {
            const y = 1 - (i + 0.5) * rowHeight;
            const caught = isHovered ? 1 - gsap.utils.clamp(0, 1, Math.abs(y - pointer.y) / settings.catchRadius) : 0;
            const target = gsap.utils.interpolate(row.ownSpeed, this.dragSpeed, caught * caught * (3 - 2 * caught));
            row.speed = gsap.utils.interpolate(row.speed, target, response);
            row.offset = gsap.utils.wrap(0, this.cells.x, row.offset + row.speed * dt);
            offsets[i] = row.offset;
            calm[i] = 1 - gsap.utils.clamp(0, 1, Math.abs(row.speed) / settings.maxSpeed);
        });

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uOffsets: offsets,
            uCalm: calm,
            uWindow: this.window,
            uReach: settings.reach,
            uPresence: presence
        });
    }

    reset() {
        this.window = null;
        super.reset();
    }
}
