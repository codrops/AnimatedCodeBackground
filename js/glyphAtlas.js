import { characters } from './utils.js';

// The cards' own text also needs these, after the random characters
const punctuation = ' .,&-\'';
const allCharacters = characters + punctuation;

// Draws every character the code is made of into a grid on a canvas,
// one cell each, at the size of a character cell on screen
// (in device pixels, so the code stays sharp)
const createGlyphAtlas = ({ fontFamily, fontSize, lineHeight }) => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = `${fontSize * dpr}px ${fontFamily}`;

    // One character cell on screen
    ctx.font = font;
    const cellWidth = Math.round(ctx.measureText('0').width);
    const cellHeight = Math.round(lineHeight * dpr);
    // Room around each cell, so the smaller mipmaps
    // don't bleed into the neighbouring characters
    const padding = 4;
    const columns = 8;
    const rows = Math.ceil(allCharacters.length / columns);

    canvas.width = columns * (cellWidth + padding * 2);
    canvas.height = rows * (cellHeight + padding * 2);

    // Resizing the canvas resets its state
    ctx.font = font;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [...allCharacters].forEach((character, i) => {
        const x = (i % columns + 0.5) * (cellWidth + padding * 2);
        const y = (Math.floor(i / columns) + 0.5) * (cellHeight + padding * 2);
        ctx.fillText(character, x, y);
    });

    // How much ink each character has: the sum of its cell's alpha
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const ink = [...allCharacters].map((character, i) => {
        const left = (i % columns) * (cellWidth + padding * 2);
        const top = Math.floor(i / columns) * (cellHeight + padding * 2);
        let sum = 0;
        for (let y = top; y < top + cellHeight + padding * 2; y++) {
            for (let x = left; x < left + cellWidth + padding * 2; x++) {
                sum += pixels[(y * canvas.width + x) * 4 + 3];
            }
        }
        return sum;
    });
    const randomInk = ink.slice(0, characters.length);
    const [lightest, heaviest] = [Math.min(...randomInk), Math.max(...randomInk)];

    return {
        canvas, dpr, cellWidth, cellHeight, padding, columns,
        // random code only uses the first 'count' characters
        count: characters.length,
        // every character's ink, from 0 (the lightest random one) to 1 (the heaviest)
        weights: ink.map(value => gsap.utils.clamp(0, 1, (value - lightest) / (heaviest - lightest))),
        // a character's place in the atlas (a space for any it doesn't have)
        indexOf: character => {
            const index = allCharacters.indexOf(character);
            return index < 0 ? allCharacters.indexOf(' ') : index;
        }
    };
};

export {
    createGlyphAtlas,
};