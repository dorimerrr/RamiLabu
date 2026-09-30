const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/Andrew/Desktop/RamiLabu';
const harvest = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/sources/ui-round7-harvest.json'), 'utf8'));
for (const i of [56, 338, 55, 555, 3, 94, 406, 445, 1019, 79, 161, 276]) {
    console.log(i, JSON.stringify(harvest[i - 1]));
}
