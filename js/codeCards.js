import { Item } from './item.js';
import { CodeItem } from './codeItem.js';
import { createGlyphAtlas } from './glyphAtlas.js';

// Turns every card into one of the WebGL variations, drawn by 'Field'.
// Visitors who prefer reduced motion, and browsers without WebGL2,
// get variation 1's hover instead (with reduced motion its characters stay still)
const initCards = Field => {
    const cards = document.querySelectorAll('.grid__item > .grid__item-img');

    if ( window.matchMedia('(prefers-reduced-motion: reduce)').matches ) {
        cards.forEach(img => new Item(img));
        return;
    }

    // The code uses the same font, size and line height as variation 1's
    const style = getComputedStyle(document.querySelector('.grid__item-img-deco'));

    // Draw the characters once the font has loaded
    document.fonts.load(`${style.fontSize} ${style.fontFamily}`).then(() => {
        const atlas = createGlyphAtlas({
            fontFamily: style.fontFamily,
            fontSize: parseFloat(style.fontSize),
            lineHeight: parseFloat(style.lineHeight)
        });

        cards.forEach(img => {
            try {
                new CodeItem(img, atlas, Field);
            }
            catch ( error ) {
                new Item(img);
            }
        });
    });
};

export {
    initCards,
};
