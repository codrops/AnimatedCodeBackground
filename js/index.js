import { Item } from './item.js';

[...document.querySelectorAll('.grid__item > .grid__item-img')].forEach(img => new Item(img));