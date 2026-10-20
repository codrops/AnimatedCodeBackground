import { glsl, CodeField } from '../codeField.js';

// Variation 10, typing: the pointer is a caret that types code where it rests,
// line by line. Fresh characters are white and cool to purple as they age,
// then fade; moving the pointer starts a new paragraph there

const displayShader = `#version 300 es
precision highp float;

out vec4 fragColor;

// when each cell was typed, in seconds (far in the past if never)
uniform sampler2D uTimes;
uniform float uTime;
// how long typed code stays, then how long it takes to fade
uniform float uHold;
uniform float uFade;
// the caret's cell, and whether it shows
uniform vec2 uCaret;
uniform float uCaretOn;
// fades the whole effect in and out
uniform float uPresence;

${glsl.noise}
${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    vec2 cell = floor(px / uCellSize);
    vec2 inCell = px / uCellSize - cell;

    // Typed characters fade in quickly, stay, then fade out
    float age = uTime - texelFetch(uTimes, ivec2(cell), 0).r;
    float shown = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(uHold, uHold + uFade, age)) * uPresence;

    // Some cells are spaces, so the code reads as words
    float coverage = hash(cell * 0.73 + 5.1) < 0.16 ? 0.0 : glyph(glyphIndex(cell), inCell, vec2(1.0, 0.0), vec2(0.0, 1.0));

    // White when fresh, cooling to purple as it ages
    vec3 color = palette(mix(1.4, 0.3, smoothstep(0.0, uHold + uFade, age)));
    float alpha = coverage * shown;
    vec4 code = vec4(color * alpha, alpha);

    // The caret: a pink block
    float caret = uCaretOn * uPresence * float(all(equal(cell, uCaret)));
    fragColor = mix(code, vec4(vec3(249.0, 38.0, 114.0) / 255.0, 1.0), caret * 0.9);
}`;

export class TypingField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // characters typed per second, and the length of a line
        speed: 40,
        lineLength: 16,
        // how far the pointer moves (in cells) before typing starts again there
        moveAway: 2,
        // how long typed code stays, then how long it takes to fade, in seconds
        hold: 1.4,
        fade: 1.8,
        // the code fades with its age after the pointer leaves
        linger: 3,
        fadeOut: 0.5,
        tapHold: 1.5
    };
    // when each cell was typed
    times;
    // the field's own clock, in seconds
    clock = 0;
    // where the current paragraph started, the caret, and typing time not used yet
    anchor = null;
    caret = null;
    pending = 0;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('display', displayShader);
    }

    // One time per cell, in a float texture that's written to directly
    resized() {
        const { gl, cells } = this;
        if ( this.times && this.timesSize.x === cells.x && this.timesSize.y === cells.y ) return;
        if ( this.times ) {
            gl.deleteTexture(this.times);
        }
        this.times = gl.createTexture();
        this.timesSize = {...cells};
        gl.bindTexture(gl.TEXTURE_2D, this.times);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.clearTimes();
        this.anchor = null;
    }

    // Mark every cell as never typed
    clearTimes() {
        const { gl, cells } = this;
        gl.bindTexture(gl.TEXTURE_2D, this.times);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cells.x, cells.y, 0, gl.RED, gl.FLOAT, new Float32Array(cells.x * cells.y).fill(-1000));
    }

    // Type one character at the caret, then move the caret on
    type() {
        const { gl, caret, cells } = this;
        const settings = TypingField.settings;
        if ( caret.y >= cells.y ) return;

        gl.bindTexture(gl.TEXTURE_2D, this.times);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, caret.x, caret.y, 1, 1, gl.RED, gl.FLOAT, new Float32Array([this.clock]));

        // At the end of a line (or of the card), the next line starts under the first character
        caret.x++;
        if ( caret.x >= caret.start + settings.lineLength || caret.x >= cells.x ) {
            caret.x = caret.start;
            caret.y++;
        }
    }

    render({ dt, pointer, isHovered, presence }) {
        const settings = TypingField.settings;
        this.clock += dt;

        // The pointer's cell (cells count from the top)
        const cell = {
            x: gsap.utils.clamp(0, this.cells.x - 1, Math.floor(pointer.x * this.canvas.width / this.atlas.cellWidth)),
            y: gsap.utils.clamp(0, this.cells.y - 1, Math.floor((1 - pointer.y) * this.canvas.height / this.atlas.cellHeight))
        };

        let isTyping = false;
        if ( isHovered ) {
            // A new paragraph starts wherever the pointer has moved to
            if ( !this.anchor || Math.max(Math.abs(cell.x - this.anchor.x), Math.abs(cell.y - this.anchor.y)) > settings.moveAway ) {
                this.anchor = {...cell};
                // near the right edge, lines start further left so a whole line fits
                const start = Math.max(0, Math.min(cell.x, this.cells.x - settings.lineLength));
                this.caret = {x: start, y: cell.y, start};
                this.pending = 0;
            }
            // Type as many characters as are due
            this.pending += dt * settings.speed;
            isTyping = this.caret.y < this.cells.y;
            while ( this.pending >= 1 ) {
                this.pending--;
                this.type();
            }
        }

        // The caret shows while typing, and blinks when typing has stopped
        const caretOn = isHovered && (isTyping || this.clock % 0.9 < 0.45);

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uTimes: this.times,
            uTime: this.clock,
            uHold: settings.hold,
            uFade: settings.fade,
            uCaret: caretOn ? [this.caret.x, this.caret.y] : [-1, -1],
            uCaretOn: caretOn ? 1 : 0,
            uPresence: presence
        });
    }

    reset() {
        this.clearTimes();
        this.anchor = null;
        super.reset();
    }
}
