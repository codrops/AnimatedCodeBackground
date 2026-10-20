import { glsl, CodeField } from '../codeField.js';

// Variation 3, decrypt: away from the pointer the code stays scrambled; near it
// the characters flicker like a decoder, then lock one by one into the card's
// own sentence, and scramble again once the pointer has moved on

// How decrypted each cell is, and whether it has locked onto the text
const stateShader = `#version 300 es
precision highp float;

out vec4 fragColor;

// r: how decrypted the cell is, g: 1 once it has locked, b: how much it scrambles
uniform sampler2D uState;
// one cell's size, in uv
uniform vec2 uCellUv;
uniform vec2 uPointer;
// 1 while the pointer is over the card
uniform float uHover;
// how close to the pointer the code decrypts, in uv
uniform float uRadius;
// how quickly it decrypts near the pointer, and how quickly it wears off elsewhere
uniform float uRise;
uniform float uDecay;
uniform float uDt;

${glsl.noise}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 state = texelFetch(uState, cell, 0);

    // The cell's center (cells count from the top)
    vec2 uv = vec2((float(cell.x) + 0.5) * uCellUv.x, 1.0 - (float(cell.y) + 0.5) * uCellUv.y);
    float near = uHover * smoothstep(uRadius, uRadius * 0.3, distance(uv, uPointer));

    // It builds up quickly near the pointer, and wears off slowly elsewhere
    float decrypted = state.r;
    decrypted = near > decrypted
        ? mix(decrypted, near, 1.0 - exp(-uRise * uDt))
        : max(decrypted - uDecay * uDt, 0.0);

    // Each cell locks onto the text at its own threshold,
    // so the characters resolve in a scattered order
    float threshold = 0.15 + 0.75 * hash(vec2(cell) * 1.91 + 3.7);
    float locked = step(threshold, decrypted);

    fragColor = vec4(decrypted, locked, (1.0 - locked) * smoothstep(0.02, 0.2, decrypted), 1.0);
}`;

// Scrambled characters, or the card's text where a cell has locked
const displayShader = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uState;
// the card's text, one character per cell
uniform sampler2D uText;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    vec2 cell = floor(px / uCellSize);
    vec2 inCell = px / uCellSize - cell;

    vec4 state = texelFetch(uState, ivec2(cell), 0);
    float decrypted = state.r * uPresence;
    float locked = state.g;

    float index = locked > 0.5 ? floor(texelFetch(uText, ivec2(cell), 0).r * 255.0 + 0.5) : glyphIndex(cell);
    float coverage = glyph(index, inCell, vec2(1.0, 0.0), vec2(0.0, 1.0));

    // Scrambled code is purple to lilac; the decrypted text is nearly white
    vec3 color = mix(palette(0.2 + decrypted * 0.6), palette(1.35), locked);
    float alpha = coverage * smoothstep(0.0, 0.25, decrypted) * mix(0.75, 1.0, locked);

    fragColor = vec4(color * alpha, alpha);
}`;

export class DecryptField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // how close to the pointer the code decrypts, in parts of the card
        radius: 0.25,
        // how quickly it decrypts near the pointer, and how quickly it wears off
        rise: 4,
        decay: 0.3,
        // after the pointer leaves, the text scrambles back on its own; then what's left fades
        linger: 2.5,
        fadeOut: 1,
        tapHold: 1.5
    };
    // each cell's state, and the card's text laid out in the cells
    state;
    text;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('state', stateShader);
        this.program('display', displayShader);
    }

    // One state texel and one character of text per cell
    resized() {
        const { gl, cells } = this;
        if ( this.state && this.state.read.width === cells.x && this.state.read.height === cells.y ) return;
        if ( this.state ) {
            this.deleteTarget(this.state);
            this.deleteTarget(this.text);
        }
        this.state = this.createDoubleTarget(cells.x, cells.y, {
            internalFormat: gl.RGBA16F,
            format: gl.RGBA,
            type: gl.HALF_FLOAT,
            filter: gl.NEAREST
        });

        // The card's sentence, wrapped into lines as wide as the code
        // and repeated until it fills the card
        const sentence = this.el.closest('.grid__item').querySelector('.grid__item-label').textContent;
        const lines = this.wrap(sentence, cells.x, cells.y);
        const data = new Uint8Array(cells.x * cells.y * 4);
        lines.forEach((line, y) => {
            for (let x = 0; x < cells.x; x++) {
                data[(y * cells.x + x) * 4] = this.atlas.indexOf(line[x] || ' ');
            }
        });
        this.text = this.createTarget(cells.x, cells.y, {
            internalFormat: gl.RGBA8,
            format: gl.RGBA,
            type: gl.UNSIGNED_BYTE,
            filter: gl.NEAREST,
            data
        });
    }

    // Wrap a text into 'rows' lines of at most 'columns' characters,
    // breaking between words and starting over when it runs out
    wrap(text, columns, rows) {
        const words = text.replace(/\s+/g, ' ').trim().split(' ');
        const lines = [];
        let line = '';
        for (let i = 0; lines.length < rows; i++) {
            const word = words[i % words.length];
            const next = line ? `${line} ${word}` : word;
            if ( next.length > columns && line ) {
                lines.push(line);
                line = word;
            }
            else {
                line = next;
            }
            // a word longer than a whole line is cut
            while ( line.length > columns && lines.length < rows ) {
                lines.push(line.slice(0, columns));
                line = line.slice(columns);
            }
        }
        return lines;
    }

    render({ dt, time, pointer, isHovered, presence }) {
        const settings = DecryptField.settings;

        this.pass('state', this.state.write, {
            uState: this.state.read.texture,
            uCellUv: [this.atlas.cellWidth / this.canvas.width, this.atlas.cellHeight / this.canvas.height],
            uPointer: pointer,
            uHover: isHovered ? 1 : 0,
            uRadius: settings.radius,
            uRise: settings.rise,
            uDecay: settings.decay,
            uDt: dt
        });
        this.state.swap();

        // Scrambling cells flicker fast, like a decoder
        this.reroll({ activity: this.state.read.texture, channel: [0, 0, 1, 0], rate: 20, range: [0.05, 0.6], dt, time });

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uState: this.state.read.texture,
            uText: this.text.texture,
            uPresence: presence
        });
    }

    reset() {
        this.clearTarget(this.state);
        super.reset();
    }
}
