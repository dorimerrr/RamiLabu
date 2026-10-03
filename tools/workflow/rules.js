'use strict';
const { isObject } = require('./json');
const containsJapanese = text => /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(text);
const isDigit = character => /[0-9\uff10-\uff19]/.test(character);
function outsideTags(text, visit) {
    let inTag = false;
    for (const character of text) {
        if (character === '<') inTag = true;
        else if (inTag && character === '>') inTag = false;
        visit(character, inTag);
    }
}
function normalizeTemplate(text) {
    let output = '', inRun = false;
    outsideTags(text, (character, inTag) => {
        if (!inTag && isDigit(character)) {
            if (!inRun) output += '#';
            inRun = true;
        } else { inRun = false; output += character; }
    });
    return output;
}
function placeholderCount(text) {
    let count = 0;
    outsideTags(text, (character, inTag) => { if (!inTag && character === '#') count++; });
    return count;
}
function substitute(template, original) {
    const runs = []; let run = '';
    outsideTags(original, (character, inTag) => {
        if (!inTag && isDigit(character)) run += character;
        else if (run) { runs.push(run); run = ''; }
    });
    if (run) runs.push(run);
    if (!runs.length || runs.length > 8 || placeholderCount(template) !== runs.length) return null;
    let output = '', index = 0;
    outsideTags(template, (character, inTag) => {
        if (inTag || character !== '#') output += character;
        else {
            let digits = runs[index++];
            if (!containsJapanese(template)) digits = digits.replace(/[\uff10-\uff19]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 48));
            output += digits;
        }
    });
    return output;
}
function resolveUi(table, original) {
    if (!containsJapanese(original)) return null;
    const exact = table.strings?.[original];
    if (Object.hasOwn(table.strings || {}, original) && exact && exact !== original) return exact;
    const key = normalizeTemplate(original);
    const value = table.templates?.[key];
    return key !== original && Object.hasOwn(table.templates || {}, key) && value && value !== key ? substitute(value, original) : null;
}
const tags = text => text.match(/<[^<>]*>/g) || [];
function protectedTokens(text) {
    const withoutTags = text.replace(/<[^<>]*>/g, '');
    return (withoutTags.match(/\{[^{}]*\}|%[A-Za-z_][A-Za-z0-9_]*%|\\[nrt]|\u200b/g) || []).sort();
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function entryIssues(source, translation, mode = 'exact') {
    const issues = [];
    if (typeof translation !== 'string' || !translation.trim()) return ['Empty or non-string translation'];
    if (!source || source === translation) issues.push('Empty source or identity translation');
    if (source.includes('\r') || translation.includes('\r')) issues.push('Carriage return in source/value; capture exact LF source instead');
    if (!same(tags(source), tags(translation))) issues.push('Rich-text tags or attributes changed');
    if (!same(protectedTokens(source), protectedTokens(translation))) issues.push('Protected placeholders/control codes changed');
    if (source.split('\n').length !== translation.split('\n').length) issues.push('Line-break count changed');
    if (mode === 'template') {
        const count = placeholderCount(source);
        if (!count || count > 8 || placeholderCount(translation) !== count) issues.push('Template placeholder count must match and be between 1 and 8');
        if (normalizeTemplate(source) !== source) issues.push('Template key contains literal digit runs');
        if (containsJapanese(translation)) issues.push('Japanese/full-width characters in UI template inhibit ASCII digit conversion');
    }
    // Japanese identifiers inside preserved tags/placeholders are legitimate.
    const prose = translation.replace(/<[^<>]*>|\{[^{}]*\}|%[A-Za-z_][A-Za-z0-9_]*%/g, '');
    if (/[\u3041-\u3096\u30a1-\u30fa\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(prose)) issues.push('Japanese/Chinese prose remains outside protected tokens');
    return issues;
}
function entriesOf(file, table) {
    if (!isObject(table)) throw new Error(`${file}: expected an object`);
    const entries = [];
    const add = (parts, mode) => {
        let value = table;
        for (const part of parts) value = value[part];
        if (!isObject(value)) throw new Error(`${file}: expected table ${parts.join('/')}`);
        for (const [source, translation] of Object.entries(value)) {
            if (typeof translation !== 'string') throw new Error(`${file}: expected string value`);
            entries.push({ parts: parts.concat(source), source, translation, mode });
        }
    };
    if (file === 'ui/en.json') {
        if (!same(Object.keys(table).sort(), ['strings', 'templates'])) throw new Error('UI must have exactly strings and templates');
        add(['strings'], 'exact'); add(['templates'], 'template');
    } else if (file === 'names/en.json') {
        if (!same(Object.keys(table).sort(), ['speakerNames', 'teamNames'])) throw new Error('Names must have exactly speakerNames and teamNames');
        add(['speakerNames'], 'exact'); add(['teamNames'], 'exact');
    } else if (file === 'static/en.json') {
        for (const [type, properties] of Object.entries(table)) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(type) || !isObject(properties)) throw new Error(`Invalid MasterData class: ${type}`);
            for (const property of Object.keys(properties)) {
                if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\[\])?(?:::[A-Za-z_][A-Za-z0-9_]*(?:\[\])?)*$/.test(property) || property.endsWith('[]')) throw new Error(`Invalid property path: ${property}`);
                add([type, property], 'exact');
            }
        }
    } else if (/^scenes\/[0-9]+\/en\.json$/.test(file)) add([], 'exact');
    else throw new Error(`Unsupported English resource: ${file}`);
    return entries;
}
module.exports = { containsJapanese, normalizeTemplate, placeholderCount, substitute, resolveUi, entryIssues, entriesOf };
