// Initialize mouse position object
let mousepos = {x: 0, y: 0};

// Listen for mousemove events and update
// 'mousepos' with the current mouse position
window.addEventListener('mousemove', ev => {
    // Save the mouse position
    mousepos = {x: ev.clientX, y: ev.clientY};
});

// Touch screens, which can't hover
const noHover = window.matchMedia('(hover: none)');

// Class representing a card whose code is drawn with WebGL
// by one of the variations (a CodeField)
export class CodeItem {
    // Initialize DOM and style related properties
    DOM = {
        // main DOM element
        el: null,
        // the canvas the code is drawn on, under the logo
        canvas: null,
    };
    // the variation's field, and its settings
    field;
    settings;
    // whether the pointer is over the card
    isHovered = false;
    // the pointer's position in the card on the last frame (null when it just came in)
    lastPointer = null;
    // whether a tap on a touch screen happened since the last frame
    isTap = false;
    // fades the whole effect in and out
    presence = {value: 0};
    // the tween of 'presence'
    presenceTween;
    // delayed call that ends a tap
    hideCall;

    constructor(DOM_el, atlas, Field) {
        this.DOM.el = DOM_el;
        this.DOM.canvas = document.createElement('canvas');
        this.DOM.canvas.className = 'grid__item-img-code';
        this.DOM.canvas.setAttribute('aria-hidden', 'true');
        // throws when WebGL2 isn't available, before anything is added to the page
        this.field = new Field(this.DOM.canvas, atlas, this.DOM.el);
        this.settings = Field.settings;

        this.DOM.el.prepend(this.DOM.canvas);
        this.DOM.el.classList.add('is-code');
        this.field.resize();

        // binds render, so it can be added to
        // and removed from GSAP's ticker
        this.render = this.render.bind(this);
        // sets up event listeners
        this.initEvents();
    }

    // Register event listeners for resize,
    // mouseenter, mouseleave and click
    initEvents() {
        // When the card changes size, resize the canvas
        new ResizeObserver(() => this.field.resize()).observe(this.DOM.el);

        // On mouseenter, show the effect
        this.DOM.el.addEventListener('mouseenter', () => this.show());

        // On mouseleave, hide it
        this.DOM.el.addEventListener('mouseleave', () => this.hide());

        // Touch screens can't hover: a tap shows the effect at
        // the tap point for a moment, then it goes again
        this.DOM.el.addEventListener('click', () => {
            if ( !noHover.matches ) return;

            this.isTap = true;
            this.show();
            if ( this.hideCall ) {
                this.hideCall.kill();
            }
            this.hideCall = gsap.delayedCall(this.settings.tapHold, () => this.hide());
        });
    }

    // Fade in and start rendering on GSAP's ticker
    show() {
        this.isHovered = true;
        // the path starts where the pointer is, not where it left
        this.lastPointer = null;

        if ( this.presenceTween ) {
            this.presenceTween.kill();
        }
        this.presenceTween = gsap.to(this.presence, {
            duration: this.settings.fadeIn,
            ease: 'power3',
            value: 1
        });
        gsap.ticker.add(this.render);
    }

    // Fade out (after the variation's linger time) and stop rendering
    hide() {
        this.isHovered = false;

        if ( this.presenceTween ) {
            this.presenceTween.kill();
        }
        this.presenceTween = gsap.to(this.presence, {
            delay: this.settings.linger,
            duration: this.settings.fadeOut,
            ease: 'power1.inOut',
            value: 0,
            onComplete: () => {
                gsap.ticker.remove(this.render);
                this.field.reset();
            }
        });
    }

    // Render the current frame
    render(time, deltaTime) {
        // The pointer's position in the card, from 0 to 1, y up
        // (read every frame, so scrolling moves it too)
        const rect = this.DOM.el.getBoundingClientRect();
        const pointer = {
            x: (mousepos.x - rect.left) / rect.width,
            y: 1 - (mousepos.y - rect.top) / rect.height
        };
        const from = this.lastPointer || pointer;

        this.field.render({
            dt: Math.min(deltaTime / 1000, 1 / 30),
            time: time % 1000,
            pointer,
            from,
            hasMoved: Math.hypot(pointer.x - from.x, pointer.y - from.y) > 0.001,
            // the first frame since the pointer came in
            hasEntered: this.isHovered && !this.lastPointer,
            isHovered: this.isHovered,
            isTap: this.isTap,
            presence: this.presence.value
        });

        this.isTap = false;
        this.lastPointer = this.isHovered ? pointer : null;
    }
}
