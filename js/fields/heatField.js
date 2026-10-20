import { glsl, CodeField } from '../codeField.js';

// Variation 2, heat trace: the pointer heats the code along its path. Hot code
// is large, white to pink and keeps changing; as it cools it turns purple,
// settles and shrinks into specks like a halftone, while it rises and curls
// like warm air

// Size of the heat texture (the cards are square)
const HEAT_SIZE = 256;

// The heat: it rises and curls, spreads a little, cools down,
// and the pointer adds more along its path
const heatShader = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uHeat;
uniform vec2 uTexel;
uniform float uTime;
uniform float uDt;
// how fast the heat cools, per second
uniform float uCooling;
// how fast it rises, and how much it curls, in uv per second
uniform float uRise;
uniform float uSwirl;
// the pointer's path since the last frame, in uv
uniform vec2 uFrom;
uniform vec2 uTo;
uniform float uRadius;
// the heat added along that path on this frame
uniform float uAmount;

${glsl.noise}

// Divergence-free flow from the noise's gradient, turned 90 degrees
vec2 curl(vec2 p) {
    float e = 0.02;
    float dx = noise(p + vec2(e, 0.0)) - noise(p - vec2(e, 0.0));
    float dy = noise(p + vec2(0.0, e)) - noise(p - vec2(0.0, e));
    return vec2(dy, -dx) / (2.0 * e);
}

// Distance from p to the segment ab
float segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
    return length(pa - ba * t);
}

void main() {
    // Where this texel's heat comes from
    vec2 flow = vec2(0.0, uRise) + uSwirl * curl(vUv * 2.5 + vec2(0.0, uTime * 0.12));
    vec2 from = vUv - flow * uDt;

    // A little blur spreads it as it goes (scaled to the frame's duration)
    float spread = 0.1 * min(uDt * 60.0, 2.0);
    float heat = texture(uHeat, from).r * (1.0 - 4.0 * spread)
               + (texture(uHeat, from + vec2(uTexel.x, 0.0)).r
               +  texture(uHeat, from - vec2(uTexel.x, 0.0)).r
               +  texture(uHeat, from + vec2(0.0, uTexel.y)).r
               +  texture(uHeat, from - vec2(0.0, uTexel.y)).r) * spread;

    // It cools over time
    heat *= exp(-uCooling * uDt);

    // The pointer heats a soft band along its path
    float d = segment(vUv, uFrom, uTo);
    heat += uAmount * exp(-(d * d) / (uRadius * uRadius));

    fragColor = vec4(min(heat, 1.5), 0.0, 0.0, 1.0);
}`;

// Each cell's character, sized and coloured by its heat
const displayShader = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uHeat;
// fades the whole effect in and out
uniform float uPresence;

${glsl.palette}
${glsl.glyph}

void main() {
    vec2 px = pixel();
    vec2 cell = floor(px / uCellSize);
    vec2 inCell = px / uCellSize - cell;
    float heat = texture(uHeat, cellUv(cell)).r * uPresence;

    // The character shrinks as it cools: like a halftone dot,
    // its area follows the heat
    float size = sqrt(clamp(heat / 0.9, 0.0, 1.0));
    float scale = 1.0 / max(size, 1e-3);
    vec2 q = (inCell - 0.5) * scale + 0.5;
    float coverage = glyph(glyphIndex(cell), q, vec2(scale, 0.0), vec2(0.0, scale));

    float alpha = coverage * smoothstep(0.0, 0.08, heat);
    fragColor = vec4(palette(heat) * alpha, alpha);
}`;

export class HeatField extends CodeField {
    static settings = {
        ...CodeField.settings,
        // heat added along the pointer's path on each frame it moves
        trail: 0.45,
        // heat added per second where the pointer rests
        rest: 3,
        // heat added at once by a tap on a touch screen
        tap: 1.1,
        // width of the heated band, in parts of the card
        radius: 0.06,
        tapRadius: 0.11,
        // how fast it cools, per second
        cooling: 0.55,
        // how fast it rises, and how much it curls, in parts of the card per second
        rise: 0.05,
        swirl: 0.03,
        // the code cools on its own after the pointer leaves; then what's left fades
        linger: 3.5,
        fadeOut: 1.5,
        tapHold: 0.3
    };
    // the heat
    heat;

    constructor(canvas, atlas, el) {
        super(canvas, atlas, el);
        this.program('heat', heatShader);
        this.program('display', displayShader);
        this.heat = this.createDoubleTarget(HEAT_SIZE, HEAT_SIZE, {
            internalFormat: this.gl.R16F,
            format: this.gl.RED,
            type: this.gl.HALF_FLOAT,
            filter: this.gl.LINEAR
        });
    }

    render({ dt, time, pointer, from, hasMoved, isHovered, isTap, presence }) {
        const settings = HeatField.settings;

        // Heat along the path if the pointer moved, a little more all
        // the time where it is, and a puff where a tap landed
        let amount = isHovered ? (hasMoved ? settings.trail : 0) + settings.rest * dt : 0;
        if ( isTap ) {
            amount += settings.tap;
        }

        this.pass('heat', this.heat.write, {
            uHeat: this.heat.read.texture,
            uTexel: [1 / HEAT_SIZE, 1 / HEAT_SIZE],
            uTime: time,
            uDt: dt,
            uCooling: settings.cooling,
            uRise: settings.rise,
            uSwirl: settings.swirl,
            uFrom: from,
            uTo: pointer,
            uRadius: isTap ? settings.tapRadius : settings.radius,
            uAmount: amount
        });
        this.heat.swap();

        // Hot cells keep changing, about 15 times a second at full heat
        this.reroll({ activity: this.heat.read.texture, rate: 15, range: [0.35, 1], dt, time });

        this.pass('display', null, {
            ...this.glyphUniforms(),
            uHeat: this.heat.read.texture,
            uPresence: presence
        });
    }

    reset() {
        this.clearTarget(this.heat);
        super.reset();
    }
}
