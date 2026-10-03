'use strict';
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
    if (Array.isArray(value)) return value.map(sort);
    return isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}
const digest = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => digest(canonical(value));
const location = parts => JSON.stringify(parts);
function parseJson(raw, label = 'JSON') {
    // JSON.parse alone silently overwrites duplicate source keys.
    const value = JSON.parse(raw);
    const nodes = new Map();
    let pos = 0;
    const whitespace = () => { while (/\s/.test(raw[pos] || '') && pos < raw.length) pos++; };
    function string() {
        const start = pos++;
        while (pos < raw.length) {
            if (raw[pos++] === '\\') pos++;
            else if (raw[pos - 1] === '"') return JSON.parse(raw.slice(start, pos));
        }
        throw new Error(`${label}: unterminated string`);
    }
    function scan(parts) {
        whitespace();
        const start = pos;
        const children = new Map();
        if (raw[pos] === '{') {
            pos++; whitespace();
            while (raw[pos] !== '}') {
                const keyStart = pos;
                const key = string();
                if (children.has(key)) throw new Error(`${label}: duplicate key ${location(parts.concat(key))}`);
                whitespace(); pos++; // colon; JSON.parse already checked syntax
                const child = scan(parts.concat(key));
                child.keyStart = keyStart;
                children.set(key, child);
                whitespace();
                if (raw[pos] !== ',') break;
                pos++; whitespace();
            }
            pos++;
        } else if (raw[pos] === '[') {
            pos++; whitespace(); let index = 0;
            while (raw[pos] !== ']') {
                scan(parts.concat(index++)); whitespace();
                if (raw[pos] !== ',') break;
                pos++; whitespace();
            }
            pos++;
        } else if (raw[pos] === '"') string();
        else { while (pos < raw.length && !/[\s,\]}]/.test(raw[pos])) pos++; }
        const node = { start, end: pos, children };
        nodes.set(location(parts), node);
        return node;
    }
    scan([]);
    return { value, nodes };
}
function readJson(file) { return parseJson(fs.readFileSync(file, 'utf8'), file).value; }
function getAt(root, parts) {
    let value = root;
    for (const part of parts) {
        if (!isObject(value) || !Object.hasOwn(value, part)) return undefined;
        value = value[part];
    }
    return value;
}
function setAt(root, parts, value) {
    let parent = root;
    for (const part of parts.slice(0, -1)) {
        if (!Object.hasOwn(parent, part)) Object.defineProperty(parent, part, { value: {}, enumerable: true, writable: true, configurable: true });
        if (!isObject(parent[part])) throw new Error(`Non-object parent at ${location(parts)}`);
        parent = parent[part];
    }
    Object.defineProperty(parent, parts.at(-1), { value, enumerable: true, writable: true, configurable: true });
}
function editJson(raw, changes) {
    // Replace only leaf string spans; add missing keys without reserializing the static file.
    const { value, nodes } = parseJson(raw);
    const replacements = [];
    const insertions = new Map();
    for (const { parts, translation } of changes) {
        const existing = nodes.get(location(parts));
        if (existing) {
            if (typeof getAt(value, parts) !== 'string') throw new Error(`Not a string: ${location(parts)}`);
            replacements.push({ start: existing.start, end: existing.end, text: JSON.stringify(translation) });
        } else {
            let length = parts.length - 1;
            while (!nodes.has(location(parts.slice(0, length)))) length--;
            const parentParts = parts.slice(0, length);
            if (!isObject(getAt(value, parentParts))) throw new Error('Cannot insert below a non-object');
            const key = location(parentParts);
            if (!insertions.has(key)) insertions.set(key, { parts: parentParts, added: {} });
            setAt(insertions.get(key).added, parts.slice(length), translation);
        }
    }
    for (const { parts, added } of insertions.values()) {
        const node = nodes.get(location(parts));
        const last = [...node.children.values()].at(-1);
        const at = last ? last.end : node.start + 1;
        const multiline = /[\r\n]/.test(raw.slice(node.start, node.end));
        const eol = raw.includes('\r\n') ? '\r\n' : '\n';
        let indent = '';
        if (last) indent = /(?:^|\n)([ \t]*)[^\n]*$/.exec(raw.slice(0, last.keyStart))?.[1] || '';
        else if (multiline) indent = (/\n([ \t]*)\}/.exec(raw.slice(node.start, node.end))?.[1] || '') + '  ';
        const entries = Object.entries(added).map(([key, entry]) => `${JSON.stringify(key)}: ${JSON.stringify(entry)}`);
        const separator = multiline ? eol + indent : '';
        replacements.push({ start: at, end: at, text: (last ? ',' : '') + separator + entries.join(',' + separator) });
    }
    let output = raw;
    for (const change of replacements.sort((a, b) => b.start - a.start)) output = output.slice(0, change.start) + change.text + output.slice(change.end);
    const actual = parseJson(output).value;
    for (const change of changes) if (getAt(actual, change.parts) !== change.translation) throw new Error('JSON edit failed verification');
    return output;
}
function safePath(root, relative) {
    if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe path: ${relative}`);
    const absolute = path.resolve(root, relative);
    const resolvedRoot = fs.realpathSync(root);
    let ancestor = absolute;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const realAncestor = fs.realpathSync(ancestor);
    const relation = path.relative(resolvedRoot, realAncestor);
    if (relation === '..' || relation.startsWith('..' + path.sep) || path.isAbsolute(relation)) throw new Error(`Path escapes root: ${relative}`);
    return absolute;
}
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); }
module.exports = { isObject, canonical, digest, fingerprint, parseJson, readJson, getAt, setAt, editJson, safePath, writeJson };
