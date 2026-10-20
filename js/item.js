import { getRandomString } from './utils.js';

// Initialize mouse position object
let mousepos = {x: 0, y: 0};

// Listen for mousemove events and update
// 'mousepos' with the current mouse position
window.addEventListener('mousemove', ev => {
    // Save the mouse position
    mousepos = {x: ev.clientX, y: ev.clientY};
});

// Visitors who prefer reduced motion,
// and touch screens, which can't hover
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const noHover = window.matchMedia('(hover: none)');

// Class representing a DOM element
// with some interactive behavior
export class Item {
    // Initialize DOM and style related properties
    DOM = {
        // main DOM element
        el: null,
        // decoration sub-element
        deco: null,
    };
    // tracks the x and y coordinates for animations
    renderedStyles = {
        x: {previous: 0, current: 0, amt: 0.1},
        y: {previous: 0, current: 0, amt: 0.1}
    };
    // quick setters for the --x and --y CSS variables
    setX;
    setY;
    // whether the next tick is the first one since showing
    isFirstTick = false;
    // whether a new random string is due on the next frame
    isStringStale = true;
    // tracks scroll position
    scrollVal;
    // tracks size and position of the DOM element
    rect;
    // delayed call that hides the effect again after a tap
    hideCall;

    constructor(DOM_el) {
        this.DOM.el = DOM_el;
        this.DOM.deco = this.DOM.el.querySelector('.grid__item-img-deco');
        // creates the quick setters
        this.setX = gsap.quickSetter(this.DOM.el, '--x', 'px');
        this.setY = gsap.quickSetter(this.DOM.el, '--y', 'px');
        // binds render, so it can be added to
        // and removed from GSAP's ticker
        this.render = this.render.bind(this);
        // calculates initial size and position
        this.calculateSizePosition();
        // sets up event listeners
        this.initEvents();
    }

    // Calculate and store the current scroll
    // position and size/position of the DOM element
    calculateSizePosition() {
        // current scroll
        this.scrollVal = {x: window.scrollX, y: window.scrollY};
        // size/position
        this.rect = this.DOM.el.getBoundingClientRect();
    }

    // Register event listeners for resize, mousemove,
    // mouseenter, mouseleave and click
    initEvents() {
        // On resize, recalculate the size and position
        window.addEventListener('resize', () => this.calculateSizePosition());

        // On mousemove over the element, ask for a
        // new random string on the next frame
        // (it stays still for visitors who prefer reduced motion)
        this.DOM.el.addEventListener('mousemove', () => {
            if ( !reducedMotion.matches ) {
                this.isStringStale = true;
            }
        });

        // On mouseenter, show the effect
        this.DOM.el.addEventListener('mouseenter', () => this.show());

        // On mouseleave, hide the effect
        this.DOM.el.addEventListener('mouseleave', () => this.hide());

        // Touch screens can't hover: a tap shows the effect
        // at the tap point, and it fades out again a second later
        this.DOM.el.addEventListener('click', () => {
            if ( !noHover.matches ) return;

            this.show();
            if ( this.hideCall ) {
                this.hideCall.kill();
            }
            this.hideCall = gsap.delayedCall(1, () => this.hide());
        });
    }

    // Fade in the deco element and
    // start rendering on GSAP's ticker
    show() {
        // Recalculate the size and position, as the layout
        // may have moved since load (the ad or the fonts loading)
        this.calculateSizePosition();
        // A new random string for every hover
        this.isStringStale = true;

        gsap.to(this.DOM.deco, {
            duration: .5,
            ease: 'power3',
            opacity: 1
        });
        this.isFirstTick = true;
        gsap.ticker.add(this.render);
    }

    // Stop rendering and
    // fade out the deco element
    hide() {
        gsap.ticker.remove(this.render);

        gsap.to(this.DOM.deco, {
            duration: .5,
            ease: 'power3',
            opacity: 0
        });
    }

    // Render the current frame
    render() {
        // Calculate the difference between the current
        // scroll position and the stored one
        const scrollDiff = {
            x: this.scrollVal.x - window.scrollX,
            y: this.scrollVal.y - window.scrollY
        };

        // Calculate the new translation values based on
        // the mouse position, scroll difference and
        // the element's position
        this.renderedStyles['x'].current = (mousepos.x - (scrollDiff.x + this.rect.left));
        this.renderedStyles['y'].current = (mousepos.y - (scrollDiff.y + this.rect.top));

        // If it's the first animation tick, set the
        // previous values to be the same as the current ones
        if ( this.isFirstTick ) {
            this.renderedStyles['x'].previous = this.renderedStyles['x'].current;
            this.renderedStyles['y'].previous = this.renderedStyles['y'].current;
            this.isFirstTick = false;
        }

        // Update the previous value to be an interpolation
        // between the previous and current values. The amount
        // is set for 60fps and scaled to this frame's duration,
        // so it follows at the same speed at any refresh rate
        const deltaRatio = gsap.ticker.deltaRatio();
        for (const key in this.renderedStyles ) {
            const amt = 1 - Math.pow(1 - this.renderedStyles[key].amt, deltaRatio);
            this.renderedStyles[key].previous = gsap.utils.interpolate(this.renderedStyles[key].previous, this.renderedStyles[key].current, amt);
        }

        // Apply the new styles to the DOM element
        // using CSS variables
        this.setX(this.renderedStyles['x'].previous);
        this.setY(this.renderedStyles['y'].previous);

        // If a new random string is due, generate it
        // and set it as the deco element's text
        if ( this.isStringStale ) {
            this.DOM.deco.textContent = getRandomString(2000);
            this.isStringStale = false;
        }
    }
}