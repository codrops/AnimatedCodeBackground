// Shared by every pass: one triangle that covers the whole target
const vertexShader = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

// GLSL the variations' shaders share
const glsl = {
    // Hash and smooth noise
    noise: `
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,

    // The demo's palette, from cool (0) to hot (1.45)
    palette: `
vec3 palette(float t) {
    vec3 purple = vec3(102.0, 51.0, 238.0) / 255.0;
    vec3 lilac = vec3(142.0, 100.0, 255.0) / 255.0;
    vec3 pink = vec3(249.0, 38.0, 114.0) / 255.0;
    vec3 color = mix(purple, lilac, smoothstep(0.1, 0.45, t));
    color = mix(color, pink, smoothstep(0.45, 0.85, t));
    return mix(color, vec3(1.0), smoothstep(0.95, 1.45, t));
}`,

    // The cells and their characters
    glyph: `
// which character each cell shows
uniform sampler2D uGlyphs;
// number of cells across and down
uniform vec2 uCells;
// in device pixels
uniform vec2 uCanvasSize;
uniform vec2 uCellSize;
// the characters, drawn into a grid (see glyphAtlas.js)
uniform sampler2D uAtlas;
uniform vec2 uAtlasCell;
uniform vec2 uAtlasSize;
uniform float uPadding;
uniform float uAtlasColumns;

// This pixel, in device pixels from the top left
vec2 pixel() {
    return vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
}

// The uv (y up) of a cell's center
vec2 cellUv(vec2 cell) {
    return vec2((cell.x + 0.5) * uCellSize.x / uCanvasSize.x, 1.0 - (cell.y + 0.5) * uCellSize.y / uCanvasSize.y);
}

// The character a cell shows (columns wrap around)
float glyphIndex(vec2 cell) {
    ivec2 c = ivec2(mod(cell.x, uCells.x), clamp(cell.y, 0.0, uCells.y - 1.0));
    return floor(texelFetch(uGlyphs, c, 0).r * 255.0 + 0.5);
}

// per character: r is its ink weight (0 to 1)
uniform sampler2D uLookup;

// A character's ink weight, from 0 (the lightest) to 1 (the heaviest)
float glyphWeight(float index) {
    return texelFetch(uLookup, ivec2(index, 0), 0).r;
}

// How much of a character covers point q of its cell (0 to 1, from the top left).
// dx and dy are how far q * cell size moves per screen pixel across and down,
// for the mipmap: (1, 0) and (0, 1) for a character drawn at full size
float glyph(float index, vec2 q, vec2 dx, vec2 dy) {
    if ( any(lessThan(q, vec2(0.0))) || any(greaterThan(q, vec2(1.0))) ) return 0.0;
    vec2 atlasCell = vec2(mod(index, uAtlasColumns), floor(index / uAtlasColumns));
    vec2 atlasPx = atlasCell * uAtlasCell + uPadding + q * uCellSize;
    return textureGrad(uAtlas, atlasPx / uAtlasSize, dx / uAtlasSize, dy / uAtlasSize).a;
}`
};

// Gives cells new characters where they're active
const rerollShader = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform sampler2D uGlyphs;
// what drives the changes, and which of its channels
uniform sampler2D uActivity;
uniform vec4 uChannel;
// one cell's size, in uv
uniform vec2 uCellUv;
uniform float uTime;
uniform float uDt;
uniform float uGlyphCount;
// changes per second at full activity, and the activity range that ramps up to it
uniform float uRate;
uniform vec2 uRange;

${glsl.noise}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 state = texelFetch(uGlyphs, cell, 0);

    // The activity at the cell's center (cells count from the top)
    vec2 uv = vec2((float(cell.x) + 0.5) * uCellUv.x, 1.0 - (float(cell.y) + 0.5) * uCellUv.y);
    float activity = dot(texture(uActivity, uv), uChannel);

    float chance = 1.0 - exp(-uRate * smoothstep(uRange.x, uRange.y, activity) * uDt);
    if ( hash(vec2(cell) + fract(uTime) * 61.7) < chance ) {
        state.r = floor(hash(vec2(cell) * 1.37 + uTime) * uGlyphCount) / 255.0;
    }

    fragColor = state;
}`;

// A card's code, drawn with WebGL2 on its own canvas. Each variation
// extends it with its own textures, passes and settings
class CodeField {
    // how the effect behaves; every variation sets its own
    static settings = {
        // fade in when the pointer comes in, in seconds
        fadeIn: 0.5,
        // after the pointer leaves: how long before fading out, and how long the fade takes
        linger: 0,
        fadeOut: 0.6,
        // how long a tap on a touch screen holds the effect
        tapHold: 1
    };
    // the card, its canvas and the WebGL2 context
    el;
    canvas;
    gl;
    // the characters, drawn into a grid (see glyphAtlas.js), and their weights
    atlas;
    atlasTexture;
    lookupTexture;
    // compiled programs, by name
    programs = {};
    // which character each cell shows
    glyphs;
    // number of character cells across and down
    cells = {x: 0, y: 0};

    constructor(canvas, atlas, el) {
        this.canvas = canvas;
        this.atlas = atlas;
        this.el = el;

        const gl = this.gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
        if ( !gl ) {
            throw new Error('WebGL2 isn\'t available');
        }
        // Fields are stored in half floats, which needs one of these to render into
        if ( !gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float') ) {
            throw new Error('Can\'t render into float textures');
        }

        // The characters, with mipmaps for when they're drawn smaller
        this.atlasTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Each character's weight
        const lookup = new Uint8Array(atlas.weights.length * 4);
        atlas.weights.forEach((weight, i) => {
            lookup[i * 4] = Math.round(weight * 255);
        });
        this.lookupTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.lookupTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, atlas.weights.length, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lookup);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        // One triangle that covers the whole target
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        this.program('reroll', rerollShader);
    }

    // Compile and link a program, and look up its uniforms by name
    program(name, fragmentSource) {
        const gl = this.gl;
        const program = gl.createProgram();
        [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, fragmentSource]].forEach(([type, source]) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if ( !gl.getShaderParameter(shader, gl.COMPILE_STATUS) ) {
                throw new Error(gl.getShaderInfoLog(shader));
            }
            gl.attachShader(program, shader);
        });
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.linkProgram(program);
        if ( !gl.getProgramParameter(program, gl.LINK_STATUS) ) {
            throw new Error(gl.getProgramInfoLog(program));
        }

        const uniforms = {};
        for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
            const { name } = gl.getActiveUniform(program, i);
            // arrays are listed as 'name[0]'
            uniforms[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, name);
        }
        this.programs[name] = { program, uniforms };
    }

    // A texture we can render into
    createTarget(width, height, { internalFormat, format, type, filter, data = null }) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, data);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if ( gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE ) {
            throw new Error('Can\'t render into this texture format');
        }
        return { texture, fbo, width, height };
    }

    // Two targets: read from one, write into the other, then swap
    createDoubleTarget(width, height, options) {
        return {
            read: this.createTarget(width, height, options),
            write: this.createTarget(width, height, { ...options, data: null }),
            swap() {
                [this.read, this.write] = [this.write, this.read];
            }
        };
    }

    // Delete a target, or both of a double one
    deleteTarget(target) {
        const gl = this.gl;
        (target.read ? [target.read, target.write] : [target]).forEach(({ texture, fbo }) => {
            gl.deleteTexture(texture);
            gl.deleteFramebuffer(fbo);
        });
    }

    // Clear a target, or both of a double one, to zero
    clearTarget(target) {
        const gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        (target.read ? [target.read, target.write] : [target]).forEach(({ fbo }) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);
        });
    }

    // Match the canvas to its size on screen, and
    // make one character cell per cell of the code
    resize() {
        const { gl, canvas, atlas } = this;
        const width = Math.round(canvas.clientWidth * atlas.dpr);
        const height = Math.round(canvas.clientHeight * atlas.dpr);
        if ( !width || !height || (width === canvas.width && height === canvas.height) ) return;

        canvas.width = width;
        canvas.height = height;

        const cells = {
            x: Math.ceil(width / atlas.cellWidth),
            y: Math.ceil(height / atlas.cellHeight)
        };
        if ( cells.x !== this.cells.x || cells.y !== this.cells.y ) {
            this.cells = cells;
            if ( this.glyphs ) {
                this.deleteTarget(this.glyphs);
            }
            // Every cell starts with a random character
            const data = new Uint8Array(cells.x * cells.y * 4);
            for (let i = 0; i < data.length; i += 4) {
                data[i] = Math.floor(Math.random() * atlas.count);
            }
            this.glyphs = this.createDoubleTarget(cells.x, cells.y, {
                internalFormat: gl.RGBA8,
                format: gl.RGBA,
                type: gl.UNSIGNED_BYTE,
                filter: gl.NEAREST,
                data
            });
        }
        this.resized();
    }

    // For the variations: called after every resize
    resized() {}

    // Run a program into a target (or onto the canvas), with its uniforms by name.
    // Textures get texture units in order; numbers, arrays and {x, y} become floats
    // and vectors, and a Float32Array a float array
    pass(name, target, uniforms) {
        const gl = this.gl;
        const { program, uniforms: locations } = this.programs[name];
        gl.useProgram(program);

        let unit = 0;
        Object.entries(uniforms).forEach(([key, value]) => {
            const location = locations[key];
            if ( location === undefined ) return;
            if ( value instanceof WebGLTexture ) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, value);
                gl.uniform1i(location, unit++);
            }
            else if ( typeof value === 'number' ) gl.uniform1f(location, value);
            else if ( value instanceof Float32Array ) gl.uniform1fv(location, value);
            else if ( 'x' in value ) gl.uniform2f(location, value.x, value.y);
            else gl[`uniform${value.length}fv`](location, value);
        });

        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
        gl.viewport(0, 0, target ? target.width : this.canvas.width, target ? target.height : this.canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Give active cells new characters (see rerollShader)
    reroll({ activity, channel = [1, 0, 0, 0], rate, range, dt, time }) {
        this.pass('reroll', this.glyphs.write, {
            uGlyphs: this.glyphs.read.texture,
            uActivity: activity,
            uChannel: channel,
            uCellUv: [this.atlas.cellWidth / this.canvas.width, this.atlas.cellHeight / this.canvas.height],
            uTime: time,
            uDt: dt,
            uGlyphCount: this.atlas.count,
            uRate: rate,
            uRange: range
        });
        this.glyphs.swap();
    }

    // The uniforms glsl.glyph needs
    glyphUniforms() {
        const { atlas } = this;
        return {
            uGlyphs: this.glyphs.read.texture,
            uCells: this.cells,
            uCanvasSize: [this.canvas.width, this.canvas.height],
            uCellSize: [atlas.cellWidth, atlas.cellHeight],
            uAtlas: this.atlasTexture,
            uAtlasCell: [atlas.cellWidth + atlas.padding * 2, atlas.cellHeight + atlas.padding * 2],
            uAtlasSize: [atlas.canvas.width, atlas.canvas.height],
            uPadding: atlas.padding,
            uAtlasColumns: atlas.columns,
            uLookup: this.lookupTexture
        };
    }

    // For the variations: move one frame on and draw it. 'frame' holds the
    // pointer and timing (see CodeItem's render)
    render(frame) {}

    // Clear the canvas; the variations also clear their own textures
    reset() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
}

export {
    glsl,
    CodeField,
};
