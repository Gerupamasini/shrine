# Botanical asset provenance

Source: https://github.com/dgreenheck/ez-tree
Copyright (c) 2024 Daniel Greenheck. MIT; full notice in EZ-TREE-LICENSE.txt.

The leaf PNGs, pine bark JPEG maps and grass-ground.jpg are unmodified payloads from
commit 75b02ff9155c765441fce42862dd24a4efa39777. Original paths, retrieval URLs and
SHA-256 are in tools/external-assets.json. These are the repository's MIT distribution;
we do not relabel the older bark maps as independently verified ambientCG CC0.

cedar0-impostor.png and broadleaf-impostor.png are derived renders made by
our tools/bake-forest.html from our GLBs and the above textures, with MIT attribution
retained. They are for distant canopy only. Their dimensions are in impostors.json.

The source tree generator is EZ Tree at commit dcf309bd86bd521083d9c70f01f2de45fdc7c457.
The bundled module and MIT notice are in tools/vendor. Presets are modified by
tools/build-trees.mjs. The species names cedar0/1/2 indicate the map's asset roles;
these conifer forms are adapted from a pine preset, not scans of Japanese cedars.
