import { lerp, getMousePos, getRandomString } from './utils.js';

// Initialize mouse position object
let mousepos = {x: 0, y: 0};

// Listen for mousemove events and update 
// 'mousepos' with the current mouse position
window.addEventListener('mousemove', ev => {
    // Save the mouse position
    mousepos = getMousePos(ev);
});

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
    // random string of 2000 chars
    randomString = getRandomString(2000);
    // tracks scroll position
    scrollVal;
    // tracks size and position of the DOM element
    rect;

    constructor(DOM_el) {
        this.DOM.el = DOM_el;
        this.DOM.deco = this.DOM.el.querySelector('.grid__item-img-deco');
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
    // mouseenter and mouseleave
    initEvents() {
        // On resize, recalculate the size and position
        window.addEventListener('resize', () => this.calculateSizePosition());

        // On mousemove over the element, generate a 
        // new random string
        this.DOM.el.addEventListener('mousemove', () => {
            // Get a new random string
            this.randomString = getRandomString(2000);
        });

        // On mouseenter, fade in the deco element and 
        // start the animation loop
        this.DOM.el.addEventListener('mouseenter', () => {
            gsap.to(this.DOM.deco, {
                duration: .5,
                ease: 'power3',
                opacity: 1
            });
            const isFirstTick = true;
            this.loopRender(isFirstTick);
        });
        
        // On mouseleave, stop the animation loop and 
        // fade out the deco element
        this.DOM.el.addEventListener('mouseleave', () => {
            this.stopRendering();
            
            gsap.to(this.DOM.deco, {
                duration: .5,
                ease: 'power3',
                opacity: 0
            });
        });
    }

    // Request a new animation frame to start or 
    // continue the render loop
    loopRender(isFirstTick = false) {
        if ( !this.requestId ) {
            this.requestId = requestAnimationFrame(() => this.render(isFirstTick));
        }
    }

    // Cancel any ongoing render loop
    stopRendering() {
        if ( this.requestId ) {
            window.cancelAnimationFrame(this.requestId);
            this.requestId = undefined;
        }
    }

    // Render the current frame
    render(isFirstTick) {
        // Clear requestId for the next frame
        this.requestId = undefined;
        
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
        if ( isFirstTick ) {
            this.renderedStyles['x'].previous = this.renderedStyles['x'].current;
            this.renderedStyles['y'].previous = this.renderedStyles['y'].current;
        }

        // Update the previous value to be a linear 
        // interpolation between the previous and current values
        for (const key in this.renderedStyles ) {
            this.renderedStyles[key].previous = lerp(this.renderedStyles[key].previous, this.renderedStyles[key].current, this.renderedStyles[key].amt);
        }
        
        // Apply the new styles to the DOM element 
        // using CSS variables
        gsap.set(this.DOM.el, {
            '--x': this.renderedStyles['x'].previous,
            '--y': this.renderedStyles['y'].previous
        });

        // Set the deco element's innerHTML to the random string
        this.DOM.deco.innerHTML = this.randomString;

        // Request the next frame
        this.loopRender();
    }
}