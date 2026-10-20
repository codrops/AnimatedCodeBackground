import { glsl, CodeField } from '../codeField.js';

// Variation 9, sort: near the pointer, each column of code sorts itself by how
// much ink its characters have, a few swaps at a time, so a gradient from light
// letters to heavy ones forms around the pointer. Once it has moved on, random
// swaps shuffle the code back

// One step of an odd-even transposition sort down every column: cells are paired
// with the one below or above, alternating every step, and each pair swaps if
// it's out of order. Away from the pointer, pairs swap at random now and then
const sortShader = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uGlyphs;
// per character: r is its ink weight
uniform sampler2D uLookup;
uniform vec2 uCells;
// one cell's size, in uv
uniform vec2 uCellUv;
uniform vec2 uPointer;
// 1 while the pointer is over the card
uniform float uHover;
// how close to the pointer columns sort, in uv
uniform float uRadius;
// which pairs this step (0 or 1), and a new random seed every step
uniform float uParity;
uniform float uSeed;
// the chance of a random swap per step, away from the pointer
uniform float uShuffle;

${glsl.noise}

float weight(vec4 state) {
    return texelFetch(uLookup, ivec2(floor(state.r * 255.0 + 0.5), 0), 0).r;
}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 self = texelFetch(uGlyphs, cell, 0);

    // This cell's partner (cells count from the top)
    bool isTop = int(mod(float(cell.y) + uParity, 2.0)) == 0;
    int partnerY = isTop ? cell.y + 1 : cell.y - 1;
    if ( partnerY < 0 || partnerY >= int(uCells.y) ) {
        fragColor = self;
        return;
    }
    vec4 other = texelFetch(uGlyphs, ivec2(cell.x, partnerY), 0);

    // Both cells of a pair work from the same values, so they make the same choice
    float topY = float(min(cell.y, partnerY));
    vec2 pair = vec2(float(cell.x), topY);
    vec2 uv = vec2((pair.x + 0.5) * uCellUv.x, 1.0 - (topY + 1.0) * uCellUv.y);
    float sorting = uHover * smoothstep(uRadius, uRadius * 0.4, distance(uv, uPointer));

    float topWeight = isTop ? weight(self) : weight(other);
    float bottomWeight = isTop ? weight(other) : weight(self);

    bool swap;
    if ( hash(pair + uSeed) < sorting ) {
        // Sorting: the lighter character goes on top
        swap = topWeight > bottomWeight;
    }
    else {
        swap = hash(pair * 1.31 + uSeed + 7.1) < uShuffle * (1.0 - sorting);
    }

    fragColor = swap ? other : self;
}`;

// The code in a soft window around the pointer, coloured by its weight
const displayShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

// the window's center, following the pointer, and its reach, in uv
uniform vec2 uWindow;
uniform float uReach;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    vec2 cell = floor(px / uCellSize);
    vec2 inCell = px / uCellSize - cell;

    float index = glyphIndex(cell);
    float coverage = glyph(index, inCell, vec2(1.0, 0.0), vec2(0.0, 1.0));

    // Light characters are purple, heavy ones pink to white,
    // so the sorted columns show as a gradient of colour too
    float reveal = smoothstep(uReach, uReach * 0.15, distance(vUv, uWindow)) * uPresence;
    float alpha = coverage * reveal;
    fragColor = vec4(palette(0.15 + glyphWeight(index) * 1.25) * alpha, alpha);
}`;

export class SortField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // how close to the pointer columns sort, in parts of the card
        radius: 0.3,
        // sorting steps per second
        steps: 18,
        // the chance of a random swap per step, away from the pointer
        shuffle: 0.12,
        // the window: how quickly it follows the pointer (per frame at 60fps), and its reach
        follow: 0.1,
        reach: 0.5,
        tapHold: 1.5
    };
    // the window's center, following the pointer
    window = null;
    // time towards the next sorting step, and which pairs it takes
    stepTime = 0;
    parity = 0;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('sort', sortShader);
        this.program('display', displayShader);
    }

    render({ dt, pointer, hasEntered, isHovered, presence }) {
        const settings = SortField.settings;
        const amount = 1 - Math.pow(1 - settings.follow, gsap.ticker.deltaRatio());

        // The window eases towards the pointer (it starts there when the pointer comes in)
        if ( !this.window || hasEntered ) {
            this.window = {...pointer};
        }
        this.window.x = gsap.utils.interpolate(this.window.x, pointer.x, amount);
        this.window.y = gsap.utils.interpolate(this.window.y, pointer.y, amount);

        // As many sorting steps as are due
        this.stepTime += dt * settings.steps;
        while ( this.stepTime >= 1 ) {
            this.stepTime--;
            this.parity = 1 - this.parity;
            this.pass('sort', this.glyphs.write, {
                uGlyphs: this.glyphs.read.texture,
                uLookup: this.lookupTexture,
                uCells: this.cells,
                uCellUv: [this.atlas.cellWidth / this.canvas.width, this.atlas.cellHeight / this.canvas.height],
                uPointer: pointer,
                uHover: isHovered ? 1 : 0,
                uRadius: settings.radius,
                uParity: this.parity,
                uSeed: Math.random() * 100,
                uShuffle: settings.shuffle
            });
            this.glyphs.swap();
        }

        this.pass('display', null, {
            ...this.glyphUniforms(),
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
