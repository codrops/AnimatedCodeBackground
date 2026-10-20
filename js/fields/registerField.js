import { glsl, CodeField } from '../codeField.js';

// Variation 7, misregister: the code is printed in two inks, pink and lilac.
// Moving the pointer pulls them out of register, along the movement, and they
// spring back into place when it rests, like a two-colour print

const displayShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

// the window's center, following the pointer, and its reach, in uv
uniform vec2 uWindow;
uniform float uReach;
// how far each ink is shifted, in cells (one way for pink, the other for lilac)
uniform vec2 uOffset;
// fades the whole effect in and out
uniform float uPresence;

${glsl.glyph}

// One ink: the code, shifted by 'shift' cells
float ink(vec2 px, vec2 shift) {
    vec2 p = px - shift * uCellSize;
    vec2 cell = floor(p / uCellSize);
    return glyph(glyphIndex(cell), p / uCellSize - cell, vec2(1.0, 0.0), vec2(0.0, 1.0));
}

void main() {
    vec2 px = pixel();
    float pink = ink(px, uOffset);
    float lilac = ink(px, -uOffset);

    // The inks overprint: where both print, they lighten each other
    vec3 color = 1.0 - (1.0 - vec3(249.0, 38.0, 114.0) / 255.0 * pink) * (1.0 - vec3(142.0, 100.0, 255.0) / 255.0 * lilac);

    // Shown in a soft window around the pointer, like variation 1's
    float reveal = smoothstep(uReach, uReach * 0.15, distance(vUv, uWindow)) * uPresence;
    fragColor = vec4(color, max(pink, lilac)) * reveal;
}`;

export class RegisterField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // the window: how quickly it follows the pointer (per frame at 60fps), and its reach
        follow: 0.1,
        reach: 0.5,
        // how far the inks part per unit of pointer speed, and at most, in cells
        pull: 0.01,
        maxOffset: 0.1,
        // the spring that brings them back into register, with a little sway
        stiffness: 120,
        damping: 9,
        tapHold: 1.2
    };
    // the window's center, following the pointer
    window = null;
    // the pointer's smoothed velocity, in cells per second
    velocity = {x: 0, y: 0};
    // the inks' offset and its velocity, in cells
    offset = {x: 0, y: 0};
    offsetVelocity = {x: 0, y: 0};

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('display', displayShader);
    }

    render({ dt, pointer, from, hasEntered, presence }) {
        const settings = RegisterField.settings;
        const amount = 1 - Math.pow(1 - settings.follow, gsap.ticker.deltaRatio());

        // The window eases towards the pointer (it starts there when the pointer comes in)
        if ( !this.window || hasEntered ) {
            this.window = {...pointer};
        }
        this.window.x = gsap.utils.interpolate(this.window.x, pointer.x, amount);
        this.window.y = gsap.utils.interpolate(this.window.y, pointer.y, amount);

        if ( dt ) {
            // The pointer's velocity in cells per second (y down, like the cells)
            const vx = (pointer.x - from.x) * this.cells.x / dt;
            const vy = -(pointer.y - from.y) * this.cells.y / dt;
            this.velocity.x = gsap.utils.interpolate(this.velocity.x, vx, amount);
            this.velocity.y = gsap.utils.interpolate(this.velocity.y, vy, amount);

            // The offset springs towards the pull of that velocity (none at rest)
            const clamp = gsap.utils.clamp(-settings.maxOffset, settings.maxOffset);
            ['x', 'y'].forEach(axis => {
                const target = clamp(this.velocity[axis] * settings.pull);
                const acceleration = settings.stiffness * (target - this.offset[axis]) - settings.damping * this.offsetVelocity[axis];
                this.offsetVelocity[axis] += acceleration * dt;
                this.offset[axis] += this.offsetVelocity[axis] * dt;
            });
        }

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uWindow: this.window,
            uReach: settings.reach,
            uOffset: this.offset,
            uPresence: presence
        });
    }

    reset() {
        this.window = null;
        this.velocity = {x: 0, y: 0};
        this.offset = {x: 0, y: 0};
        this.offsetVelocity = {x: 0, y: 0};
        super.reset();
    }
}
