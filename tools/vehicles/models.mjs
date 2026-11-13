// Authoring data lives in source/designs.json. Geometry is authored by Blender source/build.py.
import fs from 'node:fs';
export const specs=JSON.parse(fs.readFileSync(new URL('./source/designs.json',import.meta.url))).map(s=>({...s,wb:s.wheelbase}));
export const palette=JSON.parse(fs.readFileSync(new URL('./source/palette.json',import.meta.url)));
