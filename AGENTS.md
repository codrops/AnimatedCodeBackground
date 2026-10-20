# AGENTS.md

Notes for coding agents working on this repo. Read [README.md](README.md) first for what the demo is.

## Setup

- There is no build step, no package.json and nothing to install. Plain HTML, CSS and ES modules.
- Serve the root with any static server (`npx serve .` or `python3 -m http.server`). ES modules don't load from `file://`.
- GSAP is vendored in `js/gsap.min.js` and loaded as a classic script before the module, so `gsap` is a global. Don't import it.
- Variations 2 to 10 use raw WebGL2 (no three.js). Each one's shaders are in its file in `js/fields/`.
- The fonts (Neue Haas Grotesk Text, and Input Mono for the characters) come from the Adobe Fonts kit linked in every page.
- There are no automated tests. Check a change in a browser on every page: hover each card, move around inside it and out again, rest the pointer, scroll with the pointer over a card, resize the window, and look at the console. Tap a card on a touch screen (or in a phone emulator), and try it with reduced motion turned on.

## Map

| Path                       | What it is                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `index.html`…`index10.html` | One page per variation (01 is `index.html`). Same markup and cards; they differ in title, meta, body class, nav and script. |
| `js/index.js`              | Variation 1: makes an `Item` for every `.grid__item-img`.                                          |
| `js/item.js`               | Variation 1's effect: pointer tracking, the render loop, the random characters, showing and hiding. |
| `js/index2.js`…`index10.js` | Variations 2 to 10: each calls `initCards` with its field.                                          |
| `js/codeCards.js`          | `initCards(Field)`: draws the glyph atlas once the font has loaded, then makes a `CodeItem` per card (an `Item` with reduced motion or without WebGL2). |
| `js/codeItem.js`           | A WebGL card: its canvas, the pointer, showing and hiding with `presence`, GSAP's ticker.          |
| `js/codeField.js`          | `CodeField`, the base of every WebGL variation: context, programs, targets, the character cells and their reroll pass, and the GLSL they share (`glsl.noise`, `glsl.palette`, `glsl.glyph`). |
| `js/fields/*.js`           | One WebGL variation per file: its shaders, settings and passes (`heatField.js` 02, `decryptField.js` 03, `typesetField.js` 04, `streamField.js` 05, `wrapField.js` 06, `registerField.js` 07, `knockoutField.js` 08, `sortField.js` 09, `typingField.js` 10). |
| `js/glyphAtlas.js`         | Draws the characters into a grid on a canvas, at the cards' font size in device pixels: the random ones, then the punctuation the cards' text needs. |
| `js/utils.js`              | The character set and `getRandomString`, built on `gsap.utils.random`.                             |
| `js/gsap.min.js`           | GSAP 3, vendored.                                                                                  |
| `css/base.css`             | All styles, including the frame, the variations nav, the grid and the mask that makes variation 1. |

## How a card works

Every variation shares the cards' markup: each `.grid__item-img` holds a `.grid__item-img-deco` (the characters for variation 1, `aria-hidden`) and the logo SVG, which sits above everything (`z-index: 1`).

### Variation 1: the gradient mask

- **The look is CSS.** `.grid__item-img-deco` is a block of white monospace characters, masked by a 300px `radial-gradient` centred at `var(--x) var(--y)`. The card's `::after` covers it with a radial gradient (dark in the middle, purple to pink outwards) in `mix-blend-mode: darken`, which colours the characters.
- **`Item` moves the glow.** While a card is shown, its `render()` runs on GSAP's ticker and sets `--x` and `--y` on `.grid__item-img` (in px from the card's corner, through two `gsap.quickSetter`s) on every frame. The values ease towards the pointer with `gsap.utils.interpolate`, which gives the glow its trailing follow. The amount (`amt: 0.1`) is per frame at 60fps and scaled with `gsap.ticker.deltaRatio()`, so the follow has the same speed at any refresh rate. The first tick after showing snaps to the pointer instead.
- **No layout reads per frame.** The card's rect and the scroll position are measured in `show()` and on resize. Each frame works out where the pointer is in the card from those, plus how far the page has scrolled since. Measuring in `show()` matters: on the live server the ad fills its slot after load and moves the grid down.
- **The characters.** A new 2000-character string is made at most once per frame, only when `isStringStale` is set (by `show()`, and by `mousemove` over the card), and written with `textContent`. When the visitor prefers reduced motion, `mousemove` doesn't set it, so the characters stay still for the whole hover.
- **Showing and hiding.** `mouseenter` calls `show()`: re-measure, fade the characters in (0.5s, `power3`), add `render` to the ticker. `mouseleave` calls `hide()`: remove it from the ticker, fade out. Touch screens (`hover: none`) can't hover, so a tap (`click`) shows the card's effect at the tap point and a `gsap.delayedCall` hides it a second later; a new tap restarts that timer.
- `render` is only on the ticker while its card is shown. It's bound in the constructor, so adding it twice (a first tap fires both `mouseenter` and `click`) still leaves one.

### Variations 2 to 10: the WebGL cards

- **`CodeItem`** adds a canvas (`.grid__item-img-code`) under the logo and the class `is-code`, which hides variation 1's deco and `::after`. `show()` fades `presence` in and adds `render` to GSAP's ticker; `hide()` fades it out after the field's `linger` time, then takes `render` off the ticker and calls the field's `reset()`. A tap on a touch screen shows the effect at the tap point for the field's `tapHold`. Each frame it reads the card's rect (so scrolling moves the pointer too) and calls the field's `render(frame)` with `dt`, `time`, `pointer` and `from` (uv, y up), `hasMoved`, `hasEntered`, `isHovered`, `isTap` and `presence`.
- **`CodeField`** owns the card's WebGL2 context. The card is a grid of character cells at the cards' font size in device pixels, and `glyphs` (RGBA8, one texel per cell, counting from the top left) holds each cell's character. `reroll()` gives cells new characters where an activity texture is high. `pass(name, target, uniforms)` runs a program with its uniforms by name. In shaders, `glsl.glyph` gives `pixel()`, `cellUv()`, `glyphIndex()` and `glyph()`, which draws a character at any scale or angle through `textureGrad` (the uv jumps at cell edges, so mipmaps need the real gradients), plus `glyphWeight()`, each character's measured ink (`atlas.weights`, in the `lookupTexture`).
- **Fallbacks.** Each card has its own canvas and context, only rendering while it's shown or fading. The field throws before anything is added to the page when WebGL2 or half-float rendering isn't there (a shader that fails to compile throws too, so check the console with a field constructed by hand when a page falls back unexpectedly), and `initCards` then uses variation 1's `Item`. With reduced motion, every WebGL variation uses `Item` too (still characters).
- **GLSL ES 3.00 reserved words** can't be names: `active`, `input`, `output`, `filter`, `sample` and others.

### Variation 2: heat trace (`js/fields/heatField.js`)

- The pointer heats the card along its path, and a resting pointer keeps a hot spot. Hot code is large, white to pink, and its characters keep changing. As it cools it turns lilac then purple, stops changing, and shrinks cell by cell into specks, like a halftone. Meanwhile it rises and curls like warm air. A tap releases a puff that cools as it rises.
- The heat is a 256×256 half-float texture. Each frame it moves up and along a curl-noise flow, blurs a little, cools (`exp(-cooling * dt)`), and gets a Gaussian band along the pointer's path since the last frame (a segment, so fast moves leave an unbroken trail). Hot cells reroll about 15 times a second. The display scales each character about its cell's center so its area follows the heat (`size = sqrt(heat / 0.9)`).
- After the pointer leaves, the code cools on its own for 3.5s (`linger`), then what's left fades out over 1.5s.

### Variation 3: decrypt (`js/fields/decryptField.js`)

- Away from the pointer the code stays scrambled. Near it, the characters flicker fast like a decoder, then lock one by one, in a scattered order, into the card's own sentence (its `.grid__item-label`), readable in near-white. Once the pointer moves on, the text wears off and scrambles back cell by cell.
- Each cell has a `decrypted` value (`state` pass, one texel per cell) that rises quickly towards the pointer's nearness and falls slowly (`decay`) away from it, and a threshold of its own from a hash: past it, the cell shows the sentence's character instead of its random one. The sentence is wrapped between words into lines as wide as the code and repeated to fill the card, in the `text` texture (atlas indices). Cells that are visible but not locked reroll about 20 times a second.

### Variation 4: typeset (`js/fields/typesetField.js`)

- Around the pointer, faint loose characters drift out of place, tilted, in slow waves; near it they spring into line, upright and bright, with a small sway, and loosen again once it has passed. Loose characters close to the pointer flicker; ones in line are still.
- Each cell has an order (0 loose, 1 in line) pulled by a damped spring towards 1 near the pointer (`order` pass, one texel per cell). The `pose` pass turns it into the character's drift and angle (noise that neighbouring cells share, scaled by how loose it is). The display looks at the 3×3 cells around each pixel, because loose characters cross into their neighbours.

### Variation 5: stream (`js/fields/streamField.js`)

- Every row of code flows sideways at its own speed and direction, like a feed of data, shown in a soft window that follows the pointer. Rows near the pointer take its sideways speed: they brake and settle so they can be read when it rests, and move with it when it moves sideways. Calm rows near the pointer are the brightest.
- The rows' offsets and speeds are kept in JavaScript (doubles, so slow rows don't jitter) and passed to the shader as uniform arrays (at most 64 rows). Columns wrap around.

### Variation 6: wrap (`js/fields/wrapField.js`)

- The code reflows around the pointer like text wrapping around a round shape: each line breaks at a circle that follows the pointer and carries on past it, from the first character the circle hid. The circle opens and closes with a small spring, the characters along its rim are the brightest, and the character an edge passes through fades with how much of it is left.
- Each row's gap (half its width, in cells) is a spring in JavaScript towards the circle's chord at that row, passed as a uniform array (at most 64 rows) with the circle's center column.

### Variation 7: misregister (`js/fields/registerField.js`)

- The code is printed twice, in pink and in lilac, overprinting where both print. Moving the pointer pulls the two inks apart along the movement (a few pixels at most), and a spring brings them back into register, with a small sway, when it rests.
- Both inks are the same grid of characters, shifted by `±offset` cells. The offset is a spring towards the pointer's smoothed velocity × `pull`, clamped to `maxOffset`.

### Variation 8: knockout (`js/fields/knockoutField.js`)

- The pointer flips cells into solid blocks of colour with their characters cut out (reversed type), leaving a trail that flips back cell by cell. Charged cells that haven't flipped show their characters faintly and flicker.
- Each cell has a charge (`state` pass) that rises near the pointer and wears off slowly, and flips at its own threshold from a hash, easing between the two states (`flipSpeed`) so nothing snaps.

### Variation 9: sort (`js/fields/sortField.js`)

- Near the pointer, each column sorts itself by ink weight, light characters on top, a few swaps at a time, so a gradient from thin letters to heavy ones forms, in colour too. Away from it, random swaps shuffle the order back.
- The `sort` pass is one step of an odd-even transposition sort on the `glyphs` texture itself: each cell is paired with the one below or above (alternating every step), and the pair swaps if it's out of order. Both cells of a pair decide from the same values, so they always agree. `steps` per second.

### Variation 10: typing (`js/fields/typingField.js`)

- The pointer is a caret that types code where it rests, `speed` characters a second, in lines of `lineLength` (shifted left near the card's right edge). Fresh characters are white and cool to purple as they age, then fade. Moving the pointer more than `moveAway` cells starts a new paragraph there. A pink block caret shows while typing and blinks once it stops. Some cells are spaces, so the code reads as words.
- When each cell was typed is kept in a float texture, written one texel at a time with `texSubImage2D`; the display works out each character's age from it, on the field's own clock.

## Variations

| #  | Page          | What it does                                                                          | Notes                                  |
| -- | ------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| 01 | `index.html`  | The recreation of Evervault's customer grid: a gradient mask of random code follows the pointer. | The author's original. CSS mask, GSAP. |
| 02 | `index2.html` | Heat trace: the pointer leaves hot code that cools, shrinks into a halftone and rises. | WebGL2. Falls back to 01's hover.      |
| 03 | `index3.html` | Decrypt: near the pointer the scrambled code locks into the card's own sentence.      | WebGL2. Falls back to 01's hover.      |
| 04 | `index4.html` | Typeset: loose drifting characters spring into line near the pointer.                  | WebGL2. Falls back to 01's hover.      |
| 05 | `index5.html` | Stream: rows of code flow sideways; near the pointer they brake, and it drags them.    | WebGL2. Falls back to 01's hover.      |
| 06 | `index6.html` | Wrap: the code reflows around a circle that follows the pointer.                      | WebGL2. Falls back to 01's hover. |
| 07 | `index7.html` | Misregister: pink and lilac inks part when the pointer moves and spring back into register. | WebGL2. Falls back to 01's hover. |
| 08 | `index8.html` | Knockout: cells flip into blocks of colour with the characters cut out, then flip back. | WebGL2. Falls back to 01's hover. |
| 09 | `index9.html` | Sort: columns near the pointer sort themselves by ink weight, then shuffle back.       | WebGL2. Falls back to 01's hover. |
| 10 | `index10.html` | Typing: the pointer is a caret that types code where it rests; old lines cool and fade. | WebGL2. Falls back to 01's hover. |

## Adding a variation

1. Copy a page to `index<N>.html` and change its `<title>`, the description in all four places, the canonical, `og:url` and JSON-LD `url` (`…/index<N>.html`), the `demo-<N>` body class and its module script (`js/index<N>.js`).
2. For a WebGL variation, write `js/fields/<name>Field.js`: a class that extends `CodeField`, with `static settings` (spread `CodeField.settings` and override `fadeIn`, `linger`, `fadeOut` and `tapHold` as needed), its programs and targets in the constructor (targets that depend on the cell count go in `resized()`), `render(frame)` and `reset()`. Then `js/index<N>.js` is `initCards(<Name>Field)`. Use `glsl.palette` and `glsl.glyph` so it keeps the demo's characters and colours.
3. Add the link to the `.frame__demos` nav on **every** page. The current page's entry is a `<span class="frame__demo frame__demo--current" aria-current="page">`, not a link. The nav is a grid of numbers, five per row on phones and ten on desktop; `css/base.css` starts each new row under the first number.
4. Add the variation to the table above and describe it under "How a card works".

## Conventions

- The frame uses the CodropsTemplate markup: `header.frame`, with `.frame__links` (Article, All demos, GitHub), `.frame__tags` and `.frame__demos`. Codrops' publishing tools read the Article link and the tags from it, so keep those class names and the link text "Article". Unlike the template, the frame sits at the top of the page instead of as a fixed overlay, so it doesn't cover the grid.
- The analytics and ad scripts (`adpacks/analytics.js`, `adpacks/cda_sponsor.js`) stay commented out in the repo; they're added on the live server only. The ad fills `#cdawrap` in the frame's `sponsor` grid area, which has to exist at every width.
- Each page's description is one text in four places: the meta description, `og:description`, `twitter:description` and the JSON-LD. It isn't shown on the page. The canonical, `og:url` and JSON-LD `url` are the page's live URL (`https://tympanus.net/Tutorials/AnimatedCodeBackground/` for `index.html`, `…/index<N>.html` for the others). Change them together.
- Variations stay on the demo's subject: the pointer revealing each card's random code. They reuse its font (Input Mono for the code), its palette and its character set (`characters` in `js/utils.js`). No italics, and nothing pops in: effects fade or grow in.
- WebGL timing runs on GSAP's ticker, with `dt` capped at 1/30s, and anything eased per frame is scaled with `gsap.ticker.deltaRatio()` so it behaves the same at any refresh rate.

## Style

- JS: four-space indentation, single quotes, semicolons, and spaces inside the parentheses of `if ( … )`. A class keeps its elements in a `DOM` object and its state in commented class fields; variation 1 keeps its animated values in `renderedStyles` (`previous`, `current`, `amt`).
- Nearly every block has a comment saying what it does in plain words, wrapped over short lines. Keep that density, in the shaders too.
- CSS and HTML: tab indentation, BEM-style class names (`grid__item-img-deco`), one stylesheet.
- No dependencies besides GSAP and no build tooling unless asked.

## Ask before changing

- Each page's `<title>`, description (all four places), keywords, social tags and JSON-LD, the `frame__title` heading and the tags.
- The frame's links, the Evervault link and the credits.
- The cards' logos, labels and tags.
- Variation 1, the author's original effect: the mask's size and stops, the gradient colours and blend, the lerp amount and the fade timing.
