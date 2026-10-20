// The characters a random string is made of
const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// Picks one of the characters at random
const getRandomCharacter = gsap.utils.random([...characters], true);

// This function generates a random string of a given length
const getRandomString = length => Array.from({ length }, getRandomCharacter).join('');

export {
    characters,
    getRandomString,
};