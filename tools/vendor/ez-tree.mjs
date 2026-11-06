// ../../tmp/shrine-eztree/src/lib/tree.js
import * as THREE3 from "three";

// ../../tmp/shrine-eztree/src/lib/rng.js
var RNG = class {
  m_w = 123456789;
  m_z = 987654321;
  mask = 4294967295;
  constructor(seed) {
    this.m_w = 123456789 + seed & this.mask;
    this.m_z = 987654321 - seed & this.mask;
  }
  /**
   * Returns a random number between min and max
   */
  random(max = 1, min = 0) {
    this.m_z = 36969 * (this.m_z & 65535) + (this.m_z >> 16) & this.mask;
    this.m_w = 18e3 * (this.m_w & 65535) + (this.m_w >> 16) & this.mask;
    let result = (this.m_z << 16) + (this.m_w & 65535) >>> 0;
    result /= 4294967296;
    return (max - min) * result + min;
  }
};

// ../../tmp/shrine-eztree/src/lib/branch.js
import * as THREE from "three";
var Branch = class {
  /**
   * Generates a new branch
   * @param {THREE.Vector3} origin The starting point of the branch
   * @param {THREE.Euler} orientation The starting orientation of the branch
   * @param {number} length The length of the branch
   * @param {number} radius The radius of the branch at its starting point
   */
  constructor(origin = new THREE.Vector3(), orientation = new THREE.Euler(), length = 0, radius = 0, level = 0, sectionCount = 0, segmentCount = 0) {
    this.origin = origin.clone();
    this.orientation = orientation.clone();
    this.length = length;
    this.radius = radius;
    this.level = level;
    this.sectionCount = sectionCount;
    this.segmentCount = segmentCount;
  }
};

// ../../tmp/shrine-eztree/src/lib/enums.js
var Billboard = {
  Single: "single",
  Double: "double"
};
var TreeType = {
  Deciduous: "deciduous",
  Evergreen: "evergreen"
};

// ../../tmp/shrine-eztree/src/lib/options.js
var TreeOptions = class {
  constructor() {
    this.seed = 0;
    this.type = TreeType.Deciduous;
    this.bark = {
      // Informational identifier carried through presets. The library does not
      // consume this field; the host app uses it to resolve which texture set
      // to assign to `maps` below.
      type: "Bark001",
      // Texture maps supplied by the caller. Each entry is a THREE.Texture or
      // null. When `textured` is true, non-null maps are applied to the
      // material; null maps fall back to the tint color for that channel.
      maps: {
        color: null,
        ao: null,
        normal: null,
        roughness: null
      },
      // Tint of the tree trunk
      tint: 16777215,
      // Use face normals for shading instead of vertex normals
      flatShading: false,
      // Apply texture to bark
      textured: true,
      // Scale for the texture
      textureScale: { x: 1, y: 1 }
    };
    this.branch = {
      // Number of branch recursion levels. 0 = trunk only
      levels: 3,
      // Angle of the child branches relative to the parent branch (degrees)
      angle: {
        1: 70,
        2: 60,
        3: 60
      },
      // Number of children per branch level
      children: {
        0: 7,
        1: 7,
        2: 5
      },
      // External force encouraging tree growth in a particular direction
      force: {
        direction: { x: 0, y: 1, z: 0 },
        strength: 0.01
      },
      // Amount of curling/twisting at each branch level
      gnarliness: {
        0: 0.15,
        1: 0.2,
        2: 0.3,
        3: 0.02
      },
      // Length of each branch level
      length: {
        0: 20,
        1: 20,
        2: 10,
        3: 1
      },
      // Radius of each branch level
      radius: {
        0: 1.5,
        1: 0.7,
        2: 0.7,
        3: 0.7
      },
      // Number of sections per branch level
      sections: {
        0: 12,
        1: 10,
        2: 8,
        3: 6
      },
      // Number of radial segments per branch level
      segments: {
        0: 8,
        1: 6,
        2: 4,
        3: 3
      },
      // Defines where child branches start forming on the parent branch
      start: {
        1: 0.4,
        2: 0.3,
        3: 0.3
      },
      // Taper at each branch level
      taper: {
        0: 0.7,
        1: 0.7,
        2: 0.7,
        3: 0.7
      },
      // Amount of twist at each branch level
      twist: {
        0: 0,
        1: 0,
        2: 0,
        3: 0
      }
    };
    this.leaves = {
      // Informational identifier (e.g. 'oak', 'ash'). Library does not consume
      // it; the host app uses it to resolve which texture to assign to `map`.
      type: "oak",
      // Color map supplied by the caller. THREE.Texture or null.
      // When null, leaves render as a flat tinted quad.
      map: null,
      // Whether to use single or double/perpendicular billboards
      billboard: Billboard.Double,
      // Angle of leaves relative to parent branch (degrees)
      angle: 10,
      // Number of leaves
      count: 1,
      // Where leaves start to grow on the length of the branch (0 to 1)
      start: 0,
      // Size of the leaves
      size: 2.5,
      // Variance in leaf size between each instance
      sizeVariance: 0.7,
      // Tint color for the leaves
      tint: 16777215,
      // Controls transparency of leaf texture
      alphaTest: 0.5,
      // Calculates custom normals to imply a rounded canopy shape
      roundedNormals: true
    };
    this.trellis = {
      // Whether trellis is enabled
      enabled: false,
      // Position of trellis (z is distance from tree)
      position: { x: 0, y: 0, z: -2 },
      // Width of trellis grid (X direction)
      width: 10,
      // Height of trellis grid (Y direction)
      height: 20,
      // Distance between grid lines
      spacing: 2,
      // Force parameters
      force: {
        // How strongly branches bend toward trellis
        strength: 0.02,
        // Maximum distance at which trellis affects branches
        maxDistance: 3,
        // Distance falloff exponent (1 = linear, 2 = quadratic)
        falloff: 1
      },
      // Radius of trellis cylinders
      cylinderRadius: 0.05,
      // Whether to show trellis geometry
      visible: true,
      // Color of trellis
      color: 9127187
    };
  }
  /**
   * Copies the values from source into this object
   * @param {TreeOptions} source 
   */
  copy(source, target = this) {
    for (let key in source) {
      if (source.hasOwnProperty(key) && target.hasOwnProperty(key)) {
        const value = source[key];
        if (value !== null && typeof value === "object" && value.constructor === Object) {
          this.copy(value, target[key]);
        } else {
          target[key] = value;
        }
      }
    }
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/ash_small.json
var ash_small_default = {
  seed: 26867,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 0.5,
      y: 5
    }
  },
  branch: {
    levels: 2,
    angle: {
      "1": 48,
      "2": 75,
      "3": 60
    },
    children: {
      "0": 10,
      "1": 3,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.01
    },
    gnarliness: {
      "0": 0.11,
      "1": 0.09,
      "2": 0.05,
      "3": 0.09
    },
    length: {
      "0": 23.87,
      "1": 18,
      "2": 5.59,
      "3": 4.6
    },
    radius: {
      "0": 0.81,
      "1": 0.56,
      "2": 0.76,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 10,
      "3": 10
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.53,
      "2": 0.33,
      "3": 0
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0.3,
      "1": -0.07,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "ash",
    billboard: "double",
    angle: 55,
    count: 30,
    start: 0,
    size: 2.05,
    sizeVariance: 0.717,
    tint: 16777215,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/ash_medium.json
var ash_medium_default = {
  seed: 36330,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 0.5,
      y: 5
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 48,
      "2": 75,
      "3": 60
    },
    children: {
      "0": 7,
      "1": 4,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.01
    },
    gnarliness: {
      "0": 0.03,
      "1": 0.25,
      "2": 0.2,
      "3": 0.09
    },
    length: {
      "0": 43.47,
      "1": 27.14,
      "2": 9.51,
      "3": 4.6
    },
    radius: {
      "0": 2,
      "1": 0.63,
      "2": 0.76,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 8,
      "2": 6,
      "3": 4
    },
    segments: {
      "0": 12,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.23,
      "2": 0.33,
      "3": 0
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0.09,
      "1": -0.07,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "ash",
    billboard: "double",
    angle: 55,
    count: 16,
    start: 0,
    size: 2.67,
    sizeVariance: 0.72,
    tint: 16777215,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/ash_large.json
var ash_large_default = {
  seed: 29919,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 0.5,
      y: 5
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 39,
      "2": 39,
      "3": 51
    },
    children: {
      "0": 10,
      "1": 4,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.01
    },
    gnarliness: {
      "0": -0.05,
      "1": 0.2,
      "2": 0.16,
      "3": 0.049999999999999996
    },
    length: {
      "0": 45,
      "1": 29.42,
      "2": 15.3,
      "3": 4.6
    },
    radius: {
      "0": 3.03,
      "1": 0.53,
      "2": 0.79,
      "3": 1.11
    },
    sections: {
      "0": 12,
      "1": 8,
      "2": 6,
      "3": 4
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.32,
      "2": 0.34,
      "3": 0
    },
    taper: {
      "0": 0.7,
      "1": 0.6199999999999999,
      "2": 0.7599999999999999,
      "3": 0
    },
    twist: {
      "0": 0.09,
      "1": -0.07,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "ash",
    billboard: "double",
    angle: 30,
    count: 10,
    start: 0.01,
    size: 4.62,
    sizeVariance: 0.72,
    tint: 16777215,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/aspen_small.json
var aspen_small_default = {
  seed: 36330,
  type: "deciduous",
  bark: {
    type: "Bark002",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 1
    }
  },
  branch: {
    levels: 2,
    angle: {
      "1": 70,
      "2": 35,
      "3": 7
    },
    children: {
      "0": 4,
      "1": 3,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.010869565217391311
    },
    gnarliness: {
      "0": 0.04,
      "1": -0.010000000000000007,
      "2": 0.12,
      "3": 0.02
    },
    length: {
      "0": 23.99,
      "1": 3.36,
      "2": 7.699999999999999,
      "3": 1
    },
    radius: {
      "0": 0.36999999999999994,
      "1": 0.41,
      "2": 0.7,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 8,
      "3": 6
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.44999999999999996,
      "2": 0.32999999999999996,
      "3": 0
    },
    taper: {
      "0": 0.37,
      "1": 0.13,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "aspen",
    billboard: "double",
    angle: 30,
    count: 13,
    start: 0.2,
    size: 2.5,
    sizeVariance: 0.7,
    tint: 16775778,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/aspen_medium.json
var aspen_medium_default = {
  seed: 18020,
  type: "deciduous",
  bark: {
    type: "Bark002",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 1
    }
  },
  branch: {
    levels: 2,
    angle: {
      "1": 75,
      "2": 32,
      "3": 7
    },
    children: {
      "0": 10,
      "1": 3,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.0148
    },
    gnarliness: {
      "0": 0.05,
      "1": 0.12,
      "2": 0.12,
      "3": 0.02
    },
    length: {
      "0": 50,
      "1": 6.07,
      "2": 11.19,
      "3": 1
    },
    radius: {
      "0": 0.72,
      "1": 0.41,
      "2": 0.7,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 8,
      "3": 6
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.59,
      "2": 0.35,
      "3": 0
    },
    taper: {
      "0": 0.37,
      "1": 0.13,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "aspen",
    billboard: "double",
    angle: 30,
    count: 11,
    start: 0.124,
    size: 2.5,
    sizeVariance: 0.7,
    tint: 16775778,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/aspen_large.json
var aspen_large_default = {
  seed: 30631,
  type: "deciduous",
  bark: {
    type: "Bark002",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 1
    }
  },
  branch: {
    levels: 2,
    angle: {
      "1": 47,
      "2": 63,
      "3": 7
    },
    children: {
      "0": 10,
      "1": 6,
      "2": 0
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.021739130434782622
    },
    gnarliness: {
      "0": 0.05,
      "1": -0.030000000000000006,
      "2": 0.12,
      "3": 0.02
    },
    length: {
      "0": 69.60000000000001,
      "1": 18.56,
      "2": 11.19,
      "3": 1
    },
    radius: {
      "0": 1.11,
      "1": 0.5800000000000001,
      "2": 0.7,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 8,
      "3": 6
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.62,
      "2": 0.049999999999999975,
      "3": 0
    },
    taper: {
      "0": 0.7000000000000001,
      "1": 0.13,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "aspen",
    billboard: "double",
    angle: 36,
    count: 20,
    start: 0.15217391304347827,
    size: 3.4782608695652173,
    sizeVariance: 0.7,
    tint: 16580390,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/bush_1.json
var bush_1_default = {
  seed: 45590,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 0.5,
      y: 5
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 21.521739130434785,
      "2": 62.608695652173914,
      "3": 60
    },
    children: {
      "0": 7,
      "1": 3,
      "2": 2
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0
    },
    gnarliness: {
      "0": 0.11,
      "1": 0.09,
      "2": 0.05,
      "3": 0.09
    },
    length: {
      "0": 0.1,
      "1": 15.302173913043479,
      "2": 5.59,
      "3": 4.6
    },
    radius: {
      "0": 0.5793478260869566,
      "1": 0.9521739130434783,
      "2": 0.76,
      "3": 0.7
    },
    sections: {
      "0": 6,
      "1": 6,
      "2": 10,
      "3": 10
    },
    segments: {
      "0": 4,
      "1": 4,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.53,
      "2": 0.33,
      "3": 0
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0.3,
      "1": -0.07,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "ash",
    billboard: "double",
    angle: 55,
    count: 12,
    start: 0,
    size: 2.4456521739130435,
    sizeVariance: 0.717,
    tint: 14745557,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/bush_2.json
var bush_2_default = {
  seed: 45590,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 0.5,
      y: 5
    }
  },
  branch: {
    levels: 2,
    angle: {
      "1": 19.565217391304348,
      "2": 27.39130434782609,
      "3": 60
    },
    children: {
      "0": 10,
      "1": 3,
      "2": 2
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0
    },
    gnarliness: {
      "0": 0.021739130434782594,
      "1": 0.10869565217391308,
      "2": 0.05,
      "3": 0.09
    },
    length: {
      "0": 0.1,
      "1": 19.645652173913046,
      "2": 7.701086956521739,
      "3": 4.6
    },
    radius: {
      "0": 0.5793478260869566,
      "1": 0.9521739130434783,
      "2": 0.76,
      "3": 0.7
    },
    sections: {
      "0": 3,
      "1": 4,
      "2": 10,
      "3": 10
    },
    segments: {
      "0": 4,
      "1": 4,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.6413043478260869,
      "2": 0.7065217391304348,
      "3": 0
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0.3586956521739131,
      "1": -0.043478260869565244,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "aspen",
    billboard: "double",
    angle: 55,
    count: 7,
    start: 0,
    size: 2.4456521739130435,
    sizeVariance: 0.717,
    tint: 14745557,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/bush_3.json
var bush_3_default = {
  seed: 31343,
  type: "evergreen",
  bark: {
    type: "Bark001",
    tint: 13552830,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 0.5,
      y: 5
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 66.52173913043478,
      "2": 52.82608695652174,
      "3": 0
    },
    children: {
      "0": 13,
      "1": 4,
      "2": 4
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0
    },
    gnarliness: {
      "0": 0.05434782608695654,
      "1": 0.06521739130434778,
      "2": 0.05,
      "3": 0.09
    },
    length: {
      "0": 10.958695652173914,
      "1": 21.81739130434783,
      "2": 13.130434782608695,
      "3": 5.529347826086957
    },
    radius: {
      "0": 0.5793478260869566,
      "1": 0.9521739130434783,
      "2": 0.6858695652173914,
      "3": 0.7391304347826086
    },
    sections: {
      "0": 4,
      "1": 3,
      "2": 3,
      "3": 10
    },
    segments: {
      "0": 3,
      "1": 3,
      "2": 3,
      "3": 3
    },
    start: {
      "1": 0.14130434782608695,
      "2": 0.29347826086956524,
      "3": 0
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0.3,
      "1": -0.03260869565217389,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "pine",
    billboard: "double",
    angle: 54,
    count: 3,
    start: 0.15217391304347827,
    size: 3.0434782608695654,
    sizeVariance: 0.45652173913043476,
    tint: 10339327,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/oak_small.json
var oak_small_default = {
  seed: 30895,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 16774097,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 10
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 54,
      "2": 58,
      "3": 32
    },
    children: {
      "0": 4,
      "1": 2,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.01
    },
    gnarliness: {
      "0": 0.07,
      "1": -0.08,
      "2": 0.11,
      "3": 0.09
    },
    length: {
      "0": 28.08,
      "1": 4.55,
      "2": 9.78,
      "3": 7.16
    },
    radius: {
      "0": 1,
      "1": 1.02,
      "2": 0.69,
      "3": 1.19
    },
    sections: {
      "0": 16,
      "1": 9,
      "2": 8,
      "3": 1
    },
    segments: {
      "0": 7,
      "1": 5,
      "2": 3,
      "3": 3
    },
    start: {
      "1": 0.49,
      "2": 0.06,
      "3": 0.12
    },
    taper: {
      "0": 0.73,
      "1": 0.42,
      "2": 0.69,
      "3": 0.75
    },
    twist: {
      "0": -0.23,
      "1": 0.42,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "oak",
    billboard: "double",
    angle: 42,
    count: 14,
    start: 0.16,
    size: 1.38,
    sizeVariance: 0.7,
    tint: 14013901,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/oak_medium.json
var oak_medium_default = {
  seed: 35729,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 16774097,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 10
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 54,
      "2": 58,
      "3": 32
    },
    children: {
      "0": 6,
      "1": 4,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.02
    },
    gnarliness: {
      "0": 0,
      "1": -0.1,
      "2": -0.15,
      "3": 0.09
    },
    length: {
      "0": 37.24,
      "1": 11.08,
      "2": 12.39,
      "3": 7.16
    },
    radius: {
      "0": 1.41,
      "1": 0.9,
      "2": 0.69,
      "3": 1.19
    },
    sections: {
      "0": 8,
      "1": 6,
      "2": 3,
      "3": 1
    },
    segments: {
      "0": 7,
      "1": 5,
      "2": 3,
      "3": 3
    },
    start: {
      "1": 0.49,
      "2": 0.06,
      "3": 0.12
    },
    taper: {
      "0": 0.73,
      "1": 0.42,
      "2": 0.69,
      "3": 0.75
    },
    twist: {
      "0": -0.23,
      "1": 0.42,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "oak",
    billboard: "double",
    angle: 42,
    count: 18,
    start: 0.16,
    size: 2.5,
    sizeVariance: 0.7,
    tint: 14013901,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/oak_large.json
var oak_large_default = {
  seed: 23399,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 16774097,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 10
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 54,
      "2": 43,
      "3": 32
    },
    children: {
      "0": 9,
      "1": 5,
      "2": 3
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.02
    },
    gnarliness: {
      "0": -0.04,
      "1": 0.16,
      "2": -0.06,
      "3": 0.09
    },
    length: {
      "0": 47.7,
      "1": 29.39,
      "2": 17.62,
      "3": 7.16
    },
    radius: {
      "0": 3,
      "1": 0.69,
      "2": 0.69,
      "3": 1.19
    },
    sections: {
      "0": 16,
      "1": 9,
      "2": 8,
      "3": 3
    },
    segments: {
      "0": 12,
      "1": 5,
      "2": 3,
      "3": 3
    },
    start: {
      "1": 0.35,
      "2": 0.1,
      "3": 0
    },
    taper: {
      "0": 0.73,
      "1": 0.42,
      "2": 0.69,
      "3": 0.75
    },
    twist: {
      "0": -0.23,
      "1": 0.42,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "oak",
    billboard: "double",
    angle: 36,
    count: 10,
    start: 0.16,
    size: 4.5,
    sizeVariance: 0.7,
    tint: 14013901,
    alphaTest: 0.5
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/pine_small.json
var pine_small_default = {
  seed: 11744,
  type: "evergreen",
  bark: {
    type: "Bark003",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 1
    }
  },
  branch: {
    levels: 1,
    angle: {
      "1": 117,
      "2": 60,
      "3": 60
    },
    children: {
      "0": 91,
      "1": 7,
      "2": 5
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0
    },
    gnarliness: {
      "0": 0.05,
      "1": 0.08,
      "2": 0,
      "3": 0
    },
    length: {
      "0": 39.55,
      "1": 12.12,
      "2": 10,
      "3": 1
    },
    radius: {
      "0": 0.55,
      "1": 0.41,
      "2": 0.7,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 8,
      "3": 6
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.16,
      "2": 0.3,
      "3": 0.3
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "pine",
    billboard: "double",
    angle: 10,
    count: 21,
    start: 0,
    size: 0.965,
    sizeVariance: 0.7,
    tint: 16777215,
    alphaTest: 0.3
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/pine_medium.json
var pine_medium_default = {
  seed: 13977,
  type: "evergreen",
  bark: {
    type: "Bark003",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 1
    }
  },
  branch: {
    levels: 1,
    angle: {
      "1": 110,
      "2": 16,
      "3": 60
    },
    children: {
      "0": 82,
      "1": 3,
      "2": 5
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: -3e-3
    },
    gnarliness: {
      "0": 0.05,
      "1": 0.08,
      "2": 0,
      "3": 0
    },
    length: {
      "0": 50,
      "1": 23.87,
      "2": 14.08,
      "3": 1
    },
    radius: {
      "0": 1.05,
      "1": 0.36,
      "2": 0.7,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 8,
      "3": 6
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.27,
      "2": 0.14,
      "3": 0.3
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "pine",
    billboard: "double",
    angle: 39,
    count: 30,
    start: 0.09,
    size: 1.435,
    sizeVariance: 0.201,
    tint: 16777215,
    alphaTest: 0.3
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/pine_large.json
var pine_large_default = {
  seed: 44166,
  type: "evergreen",
  bark: {
    type: "Bark003",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 1
    }
  },
  branch: {
    levels: 1,
    angle: {
      "1": 129.1304347826087,
      "2": 16,
      "3": 60
    },
    children: {
      "0": 100,
      "1": 3,
      "2": 0
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.009000000000000001
    },
    gnarliness: {
      "0": 0.05,
      "1": 0.08,
      "2": 0,
      "3": 0
    },
    length: {
      "0": 65.25217391304348,
      "1": 34.84782608695652,
      "2": 27.246739130434783,
      "3": 1
    },
    radius: {
      "0": 1.271739130434783,
      "1": 0.366304347826087,
      "2": 0.7,
      "3": 0.7
    },
    sections: {
      "0": 12,
      "1": 10,
      "2": 8,
      "3": 6
    },
    segments: {
      "0": 8,
      "1": 6,
      "2": 4,
      "3": 3
    },
    start: {
      "1": 0.29347826086956524,
      "2": 0.14,
      "3": 0.3
    },
    taper: {
      "0": 0.7,
      "1": 0.7,
      "2": 0.7,
      "3": 0.7
    },
    twist: {
      "0": 0,
      "1": 0,
      "2": 0,
      "3": 0
    }
  },
  leaves: {
    type: "pine",
    billboard: "double",
    angle: 17,
    count: 18,
    start: 0.07608695652173914,
    size: 2.608695652173913,
    sizeVariance: 0.201,
    tint: 16777215,
    alphaTest: 0.3
  },
  trellis: {
    enabled: false
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/trellis.json
var trellis_default = {
  seed: 41563,
  type: "deciduous",
  bark: {
    type: "Bark001",
    tint: 16777215,
    flatShading: false,
    textured: true,
    textureScale: {
      x: 1,
      y: 8
    }
  },
  branch: {
    levels: 3,
    angle: {
      "1": 26,
      "2": 79,
      "3": 0
    },
    children: {
      "0": 7,
      "1": 5,
      "2": 1
    },
    force: {
      direction: {
        x: 0,
        y: 1,
        z: 0
      },
      strength: 0.026
    },
    gnarliness: {
      "0": 0,
      "1": 0.02,
      "2": -0.41,
      "3": 0.09
    },
    length: {
      "0": 4.8,
      "1": 16.9,
      "2": 11.3,
      "3": 11.1
    },
    radius: {
      "0": 0.27,
      "1": 0.71,
      "2": 0.84,
      "3": 0.48
    },
    sections: {
      "0": 6,
      "1": 12,
      "2": 10,
      "3": 4
    },
    segments: {
      "0": 3,
      "1": 3,
      "2": 3,
      "3": 3
    },
    start: {
      "1": 0.19,
      "2": 0.1,
      "3": 0.06
    },
    taper: {
      "0": 0.6,
      "1": 0.5,
      "2": 0.5,
      "3": 0.5
    },
    twist: {
      "0": -0.02,
      "1": -0.01,
      "2": 0.09,
      "3": 0
    }
  },
  leaves: {
    type: "ash",
    billboard: "single",
    angle: 30,
    count: 13,
    start: 0,
    size: 1.7,
    sizeVariance: 0.5,
    tint: 15204310,
    alphaTest: 0.5
  },
  trellis: {
    enabled: true,
    position: {
      x: 0,
      y: 0,
      z: 1.3
    },
    width: 20,
    height: 32,
    spacing: 4,
    force: {
      strength: 0.014,
      maxDistance: 18.2,
      falloff: 1.3
    },
    cylinderRadius: 0.08,
    visible: true,
    color: 5519173
  }
};

// ../../tmp/shrine-eztree/src/lib/presets/index.js
var TreePreset = {
  "Ash Small": ash_small_default,
  "Ash Medium": ash_medium_default,
  "Ash Large": ash_large_default,
  "Aspen Small": aspen_small_default,
  "Aspen Medium": aspen_medium_default,
  "Aspen Large": aspen_large_default,
  "Bush 1": bush_1_default,
  "Bush 2": bush_2_default,
  "Bush 3": bush_3_default,
  "Oak Small": oak_small_default,
  "Oak Medium": oak_medium_default,
  "Oak Large": oak_large_default,
  "Pine Small": pine_small_default,
  "Pine Medium": pine_medium_default,
  "Pine Large": pine_large_default,
  "Trellis": trellis_default
};
function loadPreset(name) {
  const preset = TreePreset[name];
  return preset ? structuredClone(preset) : new TreeOptions();
}

// ../../tmp/shrine-eztree/src/lib/trellis.js
import * as THREE2 from "three";
var Trellis = class extends THREE2.Group {
  /**
   * @param {Object} options Trellis configuration
   */
  constructor(options) {
    super();
    this.name = "Trellis";
    this.options = options;
    this.material = null;
    this.hCylinderGeo = null;
    this.vCylinderGeo = null;
  }
  /**
   * Generate the trellis geometry
   */
  generate() {
    const t = this.options;
    this.dispose();
    this.material = new THREE2.MeshStandardMaterial({
      color: t.color,
      roughness: 0.8
    });
    this.hCylinderGeo = new THREE2.CylinderGeometry(
      t.cylinderRadius,
      t.cylinderRadius,
      t.width,
      8
    );
    this.hCylinderGeo.rotateZ(Math.PI / 2);
    this.vCylinderGeo = new THREE2.CylinderGeometry(
      t.cylinderRadius,
      t.cylinderRadius,
      t.height,
      8
    );
    const hLineCount = Math.floor(t.height / t.spacing) + 1;
    for (let i = 0; i < hLineCount; i++) {
      const y = i * t.spacing;
      const mesh = new THREE2.Mesh(this.hCylinderGeo, this.material);
      mesh.position.set(t.position.x, t.position.y + y, t.position.z);
      this.add(mesh);
    }
    const vLineCount = Math.floor(t.width / t.spacing) + 1;
    for (let i = 0; i < vLineCount; i++) {
      const x = -t.width / 2 + i * t.spacing;
      const mesh = new THREE2.Mesh(this.vCylinderGeo, this.material);
      mesh.position.set(t.position.x + x, t.position.y + t.height / 2, t.position.z);
      this.add(mesh);
    }
  }
  /**
   * Find the nearest point on the trellis grid to a given position
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3}
   */
  getNearestPoint(position) {
    const t = this.options;
    const trellisX = t.position.x;
    const trellisY = t.position.y;
    const trellisZ = t.position.z;
    const minX = trellisX - t.width / 2;
    const maxX = trellisX + t.width / 2;
    const minY = trellisY;
    const maxY = trellisY + t.height;
    const clampedX = Math.max(minX, Math.min(maxX, position.x));
    const clampedY = Math.max(minY, Math.min(maxY, position.y));
    const nearestHLineY = Math.round((clampedY - minY) / t.spacing) * t.spacing + minY;
    const finalHLineY = Math.max(minY, Math.min(maxY, nearestHLineY));
    const nearestVLineX = Math.round((clampedX - minX) / t.spacing) * t.spacing + minX;
    const finalVLineX = Math.max(minX, Math.min(maxX, nearestVLineX));
    const pointOnHLine = new THREE2.Vector3(clampedX, finalHLineY, trellisZ);
    const pointOnVLine = new THREE2.Vector3(finalVLineX, clampedY, trellisZ);
    const distH = position.distanceTo(pointOnHLine);
    const distV = position.distanceTo(pointOnVLine);
    return distH < distV ? pointOnHLine : pointOnVLine;
  }
  /**
   * Clean up geometry and materials
   */
  dispose() {
    this.children.forEach((child) => {
      if (child.geometry) {
        child.geometry = null;
      }
    });
    this.clear();
    if (this.hCylinderGeo) {
      this.hCylinderGeo.dispose();
      this.hCylinderGeo = null;
    }
    if (this.vCylinderGeo) {
      this.vCylinderGeo.dispose();
      this.vCylinderGeo = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
  }
};

// ../../tmp/shrine-eztree/src/lib/tree.js
var Tree = class _Tree extends THREE3.Group {
  /**
   * @type {RNG}
   */
  rng;
  /**
   * @type {TreeOptions}
   */
  options;
  /**
   * @type {Branch[]}
   */
  branchQueue = [];
  /**
   * @param {TreeOptions} params
   */
  constructor(options = new TreeOptions()) {
    super();
    this.name = "Tree";
    this.branchesMesh = new THREE3.Mesh();
    this.leavesMesh = new THREE3.Mesh();
    this.trellisMesh = null;
    this.lod = null;
    this.skeleton = null;
    this.add(this.branchesMesh);
    this.add(this.leavesMesh);
    this.options = options;
  }
  update(elapsedTime) {
    const leafShader = this.leavesMesh.material.userData.shader;
    if (leafShader) {
      leafShader.uniforms.uTime.value = elapsedTime;
    }
  }
  /**
   * Loads a preset tree from JSON 
   * @param {string} preset 
   */
  loadPreset(name) {
    const json = loadPreset(name);
    this.loadFromJson(json);
  }
  /**
   * Loads a tree from JSON
   * @param {TreeOptions} json 
   */
  loadFromJson(json) {
    this.options.copy(json);
    this.generate();
  }
  /**
   * @typedef {Object} LODDetail
   * @property {number} [sectionStride=1] Sample every Nth section ring; the
   *   first and last rings are always kept so branch endpoints stay put
   * @property {number} [segmentFactor=1] Radial segment multiplier;
   *   segments = max(3, round(segmentCount * segmentFactor))
   * @property {number} [leafStride=1] Keep every Nth leaf
   * @property {number} [leafScale=1] Size multiplier for the kept leaves,
   *   typically 1/sqrt(kept fraction) to preserve canopy coverage
   * @property {string} [billboard] Billboard mode override for this level
   *   ('single' or 'double'); defaults to options.leaves.billboard
   */
  /**
   * @typedef {Object} LODLevel
   * @property {number} distance Camera distance at which this level activates
   * @property {number} [hysteresis] Switch hysteresis as a fraction of distance
   * @property {LODDetail} [detail] Meshing detail for this level
   */
  /**
   * Default levels for generateLODs(). LOD1 is roughly 40% of the full
   * triangle count, LOD2 roughly 20%.
   * @type {LODLevel[]}
   */
  static defaultLODLevels = [
    { distance: 0, detail: {} },
    {
      distance: 100,
      hysteresis: 0.05,
      detail: {
        sectionStride: 3,
        segmentFactor: 0.75,
        leafStride: 2,
        // Slightly under the area-preserving sqrt(2): individual leaves are
        // still resolvable at this distance, so a full compensation reads as
        // "bigger leaves" rather than "same canopy".
        leafScale: 1.25
      }
    },
    {
      distance: 250,
      hysteresis: 0.05,
      detail: {
        sectionStride: 6,
        segmentFactor: 0.4,
        leafStride: 2,
        // Deliberately under-compensated: full coverage compensation for the
        // thinning + single billboard would need 2x scale, which reads as
        // balloon leaves. A slightly sparser canopy with natural-size leaves
        // looks better at this distance (fogged, 250+ units in the demo).
        leafScale: 1.3,
        billboard: Billboard.Single
      }
    }
  ];
  /**
   * Generate a new tree
   */
  generate() {
    this.#clearLOD();
    this.#generateSkeleton();
    const buffers = this.#meshSkeleton();
    this.branches = buffers.branches;
    this.leaves = buffers.leaves;
    this.createBranchesGeometry();
    this.createLeavesGeometry();
    this.createTrellis();
  }
  /**
   * Generates the tree as a set of levels of detail hosted in a THREE.LOD
   * object inside this group. The renderer switches levels automatically
   * based on camera distance. All levels share one bark and one leaf
   * material, so update() animates wind at every level.
   * @param {LODLevel[]} levels Level descriptors, in any order
   */
  generateLODs(levels = _Tree.defaultLODLevels) {
    this.#clearLOD();
    this.#generateSkeleton();
    const barkMaterial = this.#createBarkMaterial();
    const leafMaterial = this.#createLeafMaterial();
    this.lod = new THREE3.LOD();
    this.lod.name = "TreeLOD";
    const ordered = [...levels].sort(
      (a, b) => (a.distance ?? 0) - (b.distance ?? 0)
    );
    ordered.forEach((level, index) => {
      const buffers = this.#meshSkeleton(level.detail ?? {});
      let branchesMesh, leavesMesh;
      if (index === 0) {
        this.branches = buffers.branches;
        this.leaves = buffers.leaves;
        branchesMesh = this.branchesMesh;
        leavesMesh = this.leavesMesh;
        branchesMesh.geometry.dispose();
        branchesMesh.material.dispose();
        leavesMesh.geometry.dispose();
        leavesMesh.material.dispose();
      } else {
        branchesMesh = new THREE3.Mesh();
        leavesMesh = new THREE3.Mesh();
      }
      branchesMesh.geometry = this.#buildBufferGeometry(buffers.branches);
      branchesMesh.material = barkMaterial;
      leavesMesh.geometry = this.#buildBufferGeometry(buffers.leaves);
      leavesMesh.material = leafMaterial;
      for (const mesh of [branchesMesh, leavesMesh]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      const group = new THREE3.Group();
      group.add(branchesMesh, leavesMesh);
      this.lod.addLevel(group, level.distance ?? 0, level.hysteresis ?? 0);
    });
    this.add(this.lod);
    this.createTrellis();
  }
  /**
   * Builds branch and leaf geometry at the given detail level without
   * modifying the tree's own meshes. Useful for external instancing or
   * custom LOD systems. Reuses the current skeleton, generating one first
   * if none exists.
   * @param {LODDetail} detail
   * @returns {{ branches: THREE.BufferGeometry, leaves: THREE.BufferGeometry }}
   */
  createGeometry(detail = {}) {
    if (!this.skeleton) {
      this.#generateSkeleton();
    }
    const buffers = this.#meshSkeleton(detail);
    return {
      branches: this.#buildBufferGeometry(buffers.branches),
      leaves: this.#buildBufferGeometry(buffers.leaves)
    };
  }
  /**
   * Tears down any LOD state and restores the flat branches/leaves meshes
   * as direct children, so generate() behaves as if LODs never existed.
   */
  #clearLOD() {
    if (!this.lod) return;
    this.lod.levels.forEach((level) => {
      for (const mesh of level.object.children) {
        if (mesh === this.branchesMesh || mesh === this.leavesMesh) continue;
        mesh.geometry.dispose();
      }
    });
    this.remove(this.lod);
    this.lod = null;
    this.add(this.branchesMesh, this.leavesMesh);
  }
  /**
   * Grows the tree skeleton: the section frames of every branch and the
   * placement of every leaf. All RNG consumption happens here, so any
   * number of meshing passes can run against one skeleton without changing
   * the tree's shape.
   */
  #generateSkeleton() {
    this.skeleton = {
      branches: [],
      leaves: []
    };
    this.rng = new RNG(this.options.seed);
    this.branchQueue.push(
      new Branch(
        new THREE3.Vector3(),
        new THREE3.Euler(),
        this.options.branch.length[0],
        this.options.branch.radius[0],
        0,
        this.options.branch.sections[0],
        this.options.branch.segments[0]
      )
    );
    while (this.branchQueue.length > 0) {
      const branch = this.branchQueue.shift();
      this.#growBranch(branch);
    }
  }
  /**
   * Meshes the current skeleton into geometry buffers at the given detail.
   * Consumes no RNG, so it can run repeatedly with different detail specs.
   * @param {LODDetail} detail
   */
  #meshSkeleton(detail = {}) {
    const sectionStride = Math.max(1, Math.floor(detail.sectionStride ?? 1));
    const segmentFactor = detail.segmentFactor ?? 1;
    const leafStride = Math.max(1, Math.floor(detail.leafStride ?? 1));
    const leafScale = detail.leafScale ?? 1;
    const billboard = detail.billboard ?? this.options.leaves.billboard;
    const branches = {
      verts: [],
      normals: [],
      indices: [],
      uvs: [],
      windFactor: []
    };
    const leaves = {
      verts: [],
      normals: [],
      indices: [],
      uvs: []
    };
    for (const skeletonBranch of this.skeleton.branches) {
      this.#meshBranch(branches, skeletonBranch, sectionStride, segmentFactor);
    }
    for (let i = 0; i < this.skeleton.leaves.length; i += leafStride) {
      this.#meshLeaf(leaves, this.skeleton.leaves[i], leafScale, billboard);
    }
    return { branches, leaves };
  }
  /**
   * Grows a branch's skeleton, queueing child branches and recording leaf
   * placements. Consumes RNG in the exact order of the original interleaved
   * generator so seeds keep producing identical trees.
   * @param {Branch} branch
   * @returns
   */
  #growBranch(branch) {
    let sectionOrientation = branch.orientation.clone();
    let sectionOrigin = branch.origin.clone();
    let sectionLength = branch.length / branch.sectionCount / (this.options.type === "Deciduous" ? this.options.branch.levels - 1 : 1);
    let sections = [];
    for (let i = 0; i <= branch.sectionCount; i++) {
      let sectionRadius = branch.radius;
      if (i === branch.sectionCount && branch.level === this.options.branch.levels) {
        sectionRadius = 1e-3;
      } else if (this.options.type === TreeType.Deciduous) {
        sectionRadius *= 1 - this.options.branch.taper[branch.level] * (i / branch.sectionCount);
      } else if (this.options.type === TreeType.Evergreen) {
        sectionRadius *= 1 - i / branch.sectionCount;
      }
      sections.push({
        origin: sectionOrigin.clone(),
        orientation: sectionOrientation.clone(),
        radius: sectionRadius
      });
      sectionOrigin.add(
        new THREE3.Vector3(0, sectionLength, 0).applyEuler(sectionOrientation)
      );
      const gnarliness = Math.max(1, 1 / Math.sqrt(sectionRadius)) * this.options.branch.gnarliness[branch.level];
      sectionOrientation.x += this.rng.random(gnarliness, -gnarliness);
      sectionOrientation.z += this.rng.random(gnarliness, -gnarliness);
      const qSection = new THREE3.Quaternion().setFromEuler(sectionOrientation);
      const qTwist = new THREE3.Quaternion().setFromAxisAngle(
        new THREE3.Vector3(0, 1, 0),
        this.options.branch.twist[branch.level]
      );
      qSection.multiply(qTwist);
      const sectionUp = new THREE3.Vector3(0, 1, 0).applyQuaternion(qSection);
      const target = new THREE3.Vector3().copy(this.options.branch.force.direction).normalize();
      const axis = new THREE3.Vector3().crossVectors(sectionUp, target);
      const sinFull = axis.length();
      if (sinFull > 1e-6) {
        axis.divideScalar(sinFull);
        const fullAngle = Math.atan2(sinFull, sectionUp.dot(target));
        const step = this.options.branch.force.strength / sectionRadius;
        const clamped = Math.max(-fullAngle, Math.min(fullAngle, step));
        qSection.premultiply(
          new THREE3.Quaternion().setFromAxisAngle(axis, clamped)
        );
      }
      if (this.options.trellis.enabled) {
        const trellisResult = this.calculateTrellisForce(sectionOrigin, sectionRadius);
        if (trellisResult) {
          const qTrellis = new THREE3.Quaternion().setFromUnitVectors(
            new THREE3.Vector3(0, 1, 0),
            trellisResult.direction
          );
          qSection.rotateTowards(qTrellis, trellisResult.strength);
        }
      }
      sectionOrientation.setFromQuaternion(qSection);
    }
    this.skeleton.branches.push({
      sections,
      segmentCount: branch.segmentCount,
      baseRadius: branch.radius
    });
    if (this.options.type === "deciduous") {
      const lastSection = sections[sections.length - 1];
      if (branch.level < this.options.branch.levels) {
        this.branchQueue.push(
          new Branch(
            lastSection.origin,
            lastSection.orientation,
            this.options.branch.length[branch.level + 1],
            lastSection.radius,
            branch.level + 1,
            // Section count and segment count must be same as parent branch
            // since the child branch is growing from the end of the parent branch
            branch.sectionCount,
            branch.segmentCount
          )
        );
      } else {
        this.#recordLeaf(lastSection.origin, lastSection.orientation);
      }
    }
    if (branch.level === this.options.branch.levels) {
      this.generateLeaves(sections);
    } else if (branch.level < this.options.branch.levels) {
      this.generateChildBranches(
        this.options.branch.children[branch.level],
        branch.level + 1,
        sections
      );
    }
  }
  /**
   * Generate branches from a parent branch
   * @param {number} count The number of child branches to generate
   * @param {number} level The level of the child branches
   * @param {{
   *  origin: THREE.Vector3,
   *  orientation: THREE.Euler,
   *  radius: number
   * }[]} sections The parent branch's sections
   * @returns
   */
  generateChildBranches(count, level, sections) {
    const radialOffset = this.rng.random();
    const startMin = this.options.branch.start[level];
    const heightStep = (1 - startMin) / count;
    const angleSlots = this.shuffledIndices(count);
    for (let i = 0; i < count; i++) {
      let childBranchStart = startMin + (i + this.rng.random()) * heightStep;
      const sectionIndex = Math.floor(childBranchStart * (sections.length - 1));
      let sectionA, sectionB;
      sectionA = sections[sectionIndex];
      if (sectionIndex === sections.length - 1) {
        sectionB = sectionA;
      } else {
        sectionB = sections[sectionIndex + 1];
      }
      const alpha = (childBranchStart - sectionIndex / (sections.length - 1)) / (1 / (sections.length - 1));
      const childBranchOrigin = new THREE3.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha
      );
      const childBranchRadius = this.options.branch.radius[level] * ((1 - alpha) * sectionA.radius + alpha * sectionB.radius);
      const qA = new THREE3.Quaternion().setFromEuler(sectionA.orientation);
      const qB = new THREE3.Quaternion().setFromEuler(sectionB.orientation);
      const parentOrientation = new THREE3.Euler().setFromQuaternion(
        qB.slerp(qA, alpha)
      );
      const radialJitter = this.rng.random(0.5, -0.5);
      const radialAngle = 2 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const q1 = new THREE3.Quaternion().setFromAxisAngle(
        new THREE3.Vector3(1, 0, 0),
        this.options.branch.angle[level] / (180 / Math.PI)
      );
      const q2 = new THREE3.Quaternion().setFromAxisAngle(
        new THREE3.Vector3(0, 1, 0),
        radialAngle
      );
      const q3 = new THREE3.Quaternion().setFromEuler(parentOrientation);
      const childBranchOrientation = new THREE3.Euler().setFromQuaternion(
        q3.multiply(q2.multiply(q1))
      );
      let childBranchLength = this.options.branch.length[level] * (this.options.type === TreeType.Evergreen ? 1 - childBranchStart : 1);
      this.branchQueue.push(
        new Branch(
          childBranchOrigin,
          childBranchOrientation,
          childBranchLength,
          childBranchRadius,
          level,
          this.options.branch.sections[level],
          this.options.branch.segments[level]
        )
      );
    }
  }
  /**
   * Logic for spawning child branches from a parent branch's section
   * @param {{
  *  origin: THREE.Vector3,
  *  orientation: THREE.Euler,
  *  radius: number
  * }[]} sections The parent branch's sections
  * @returns
  */
  generateLeaves(sections) {
    const radialOffset = this.rng.random();
    const count = this.options.leaves.count;
    const startMin = this.options.leaves.start;
    const heightStep = (1 - startMin) / count;
    const angleSlots = this.shuffledIndices(count);
    for (let i = 0; i < count; i++) {
      let leafStart = startMin + (i + this.rng.random()) * heightStep;
      const sectionIndex = Math.floor(leafStart * (sections.length - 1));
      let sectionA, sectionB;
      sectionA = sections[sectionIndex];
      if (sectionIndex === sections.length - 1) {
        sectionB = sectionA;
      } else {
        sectionB = sections[sectionIndex + 1];
      }
      const alpha = (leafStart - sectionIndex / (sections.length - 1)) / (1 / (sections.length - 1));
      const leafOrigin = new THREE3.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha
      );
      const qA = new THREE3.Quaternion().setFromEuler(sectionA.orientation);
      const qB = new THREE3.Quaternion().setFromEuler(sectionB.orientation);
      const parentOrientation = new THREE3.Euler().setFromQuaternion(
        qB.slerp(qA, alpha)
      );
      const radialJitter = this.rng.random(0.5, -0.5);
      const radialAngle = 2 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const q1 = new THREE3.Quaternion().setFromAxisAngle(
        new THREE3.Vector3(1, 0, 0),
        this.options.leaves.angle / (180 / Math.PI)
      );
      const q2 = new THREE3.Quaternion().setFromAxisAngle(
        new THREE3.Vector3(0, 1, 0),
        radialAngle
      );
      const q3 = new THREE3.Quaternion().setFromEuler(parentOrientation);
      const leafOrientation = new THREE3.Euler().setFromQuaternion(
        q3.multiply(q2.multiply(q1))
      );
      this.#recordLeaf(leafOrigin, leafOrientation);
    }
  }
  /**
  * Records a leaf placement in the skeleton. The size variance is sampled
  * here so the meshing passes stay RNG-free.
  * @param {THREE.Vector3} origin The starting point of the leaf
  * @param {THREE.Euler} orientation The orientation of the leaf
  */
  #recordLeaf(origin, orientation) {
    const size = this.options.leaves.size * (1 + this.rng.random(
      this.options.leaves.sizeVariance,
      -this.options.leaves.sizeVariance
    ));
    this.skeleton.leaves.push({
      origin: origin.clone(),
      orientation: orientation.clone(),
      size
    });
  }
  /**
  * Emits the quad geometry for one skeleton leaf into the buffers
  * @param {{verts: number[], normals: number[], indices: number[], uvs: number[]}} buffers
  * @param {{origin: THREE.Vector3, orientation: THREE.Euler, size: number}} leaf
  * @param {number} scale Size multiplier for this detail level
  * @param {string} billboard Billboard mode for this detail level
  */
  #meshLeaf(buffers, leaf, scale, billboard) {
    let i = buffers.verts.length / 3;
    const { origin, orientation } = leaf;
    const leafSize = leaf.size * scale;
    const W = leafSize;
    const L = leafSize;
    const createLeaf = (rotation) => {
      const v = [
        new THREE3.Vector3(-W / 2, L, 0),
        new THREE3.Vector3(-W / 2, 0, 0),
        new THREE3.Vector3(W / 2, 0, 0),
        new THREE3.Vector3(W / 2, L, 0)
      ].map(
        (v2) => v2.applyEuler(new THREE3.Euler(0, rotation, 0)).applyEuler(orientation).add(origin)
      );
      buffers.verts.push(
        v[0].x,
        v[0].y,
        v[0].z,
        v[1].x,
        v[1].y,
        v[1].z,
        v[2].x,
        v[2].y,
        v[2].z,
        v[3].x,
        v[3].y,
        v[3].z
      );
      const n = new THREE3.Vector3(0, 0, 1).applyEuler(orientation);
      const roundedNormals = this.options.leaves.roundedNormals;
      let n1 = roundedNormals ? new THREE3.Vector3().copy(n).add(v[0]).sub(origin).normalize() : n;
      let n2 = roundedNormals ? new THREE3.Vector3().copy(n).add(v[1]).sub(origin).normalize() : n;
      let n3 = roundedNormals ? new THREE3.Vector3().copy(n).add(v[2]).sub(origin).normalize() : n;
      let n4 = roundedNormals ? new THREE3.Vector3().copy(n).add(v[3]).sub(origin).normalize() : n;
      buffers.normals.push(
        n1.x,
        n1.y,
        n1.z,
        n2.x,
        n2.y,
        n2.z,
        n3.x,
        n3.y,
        n3.z,
        n4.x,
        n4.y,
        n4.z
      );
      buffers.uvs.push(0, 1, 0, 0, 1, 0, 1, 1);
      buffers.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
      i += 4;
    };
    createLeaf(0);
    if (billboard === Billboard.Double) {
      createLeaf(Math.PI / 2);
    }
  }
  /**
   * Fisher-Yates shuffle of [0..count-1] using the tree's RNG so results stay
   * seed-reproducible.
   * @param {number} count
   * @returns {number[]}
   */
  shuffledIndices(count) {
    const arr = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
      const r = Math.floor(this.rng.random() * (k + 1));
      [arr[k], arr[r]] = [arr[r], arr[k]];
    }
    return arr;
  }
  /**
   * Emits the ring geometry and indices for one skeleton branch
   * @param {{verts: number[], normals: number[], indices: number[], uvs: number[]}} buffers
   * @param {{sections: {origin: THREE.Vector3, orientation: THREE.Euler, radius: number}[], segmentCount: number, baseRadius: number}} skeletonBranch
   * @param {number} sectionStride Sample every Nth section ring
   * @param {number} segmentFactor Radial segment multiplier
   */
  #meshBranch(buffers, skeletonBranch, sectionStride, segmentFactor) {
    const { sections, segmentCount, baseRadius } = skeletonBranch;
    const segments = Math.max(3, Math.round(segmentCount * segmentFactor));
    const wrapsX = Math.max(
      1,
      Math.round(baseRadius * this.options.bark.textureScale.x)
    );
    const sampled = [];
    for (let i = 0; i < sections.length; i += sectionStride) {
      sampled.push(sections[i]);
    }
    if ((sections.length - 1) % sectionStride !== 0) {
      sampled.push(sections[sections.length - 1]);
    }
    const indexOffset = buffers.verts.length / 3;
    for (let k = 0; k < sampled.length; k++) {
      const section = sampled[k];
      let first;
      for (let j = 0; j < segments; j++) {
        let angle = 2 * Math.PI * j / segments;
        const vertex = new THREE3.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(section.radius).applyEuler(section.orientation).add(section.origin);
        const normal = new THREE3.Vector3(Math.cos(angle), 0, Math.sin(angle)).applyEuler(section.orientation).normalize();
        const uv = new THREE3.Vector2(
          j / segments * wrapsX,
          k % 2 === 0 ? 0 : 1
        );
        buffers.verts.push(...Object.values(vertex));
        buffers.normals.push(...Object.values(normal));
        buffers.uvs.push(...Object.values(uv));
        if (j === 0) {
          first = { vertex, normal, uv };
        }
      }
      buffers.verts.push(...Object.values(first.vertex));
      buffers.normals.push(...Object.values(first.normal));
      buffers.uvs.push(wrapsX, first.uv.y);
    }
    let v1, v2, v3, v4;
    const N = segments + 1;
    for (let i = 0; i < sampled.length - 1; i++) {
      for (let j = 0; j < segments; j++) {
        v1 = indexOffset + i * N + j;
        v2 = indexOffset + i * N + (j + 1);
        v3 = v1 + N;
        v4 = v2 + N;
        buffers.indices.push(v1, v3, v2, v2, v3, v4);
      }
    }
  }
  /**
   * Builds a BufferGeometry from raw attribute buffers
   * @param {{verts: number[], normals: number[], indices: number[], uvs: number[]}} buffers
   * @returns {THREE.BufferGeometry}
   */
  #buildBufferGeometry(buffers) {
    const g = new THREE3.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE3.BufferAttribute(new Float32Array(buffers.verts), 3)
    );
    g.setAttribute(
      "normal",
      new THREE3.BufferAttribute(new Float32Array(buffers.normals), 3)
    );
    g.setAttribute(
      "uv",
      new THREE3.BufferAttribute(new Float32Array(buffers.uvs), 2)
    );
    g.setIndex(
      new THREE3.BufferAttribute(new Uint16Array(buffers.indices), 1)
    );
    g.computeBoundingSphere();
    return g;
  }
  /**
   * Creates the bark material from the current options
   * @returns {THREE.MeshStandardMaterial}
   */
  #createBarkMaterial() {
    const mat = new THREE3.MeshStandardMaterial({
      name: "branches",
      flatShading: this.options.bark.flatShading,
      color: new THREE3.Color(this.options.bark.tint),
      metalness: 0,
      roughness: 1
    });
    if (this.options.bark.textured) {
      const scale = this.options.bark.textureScale;
      const maps = this.options.bark.maps;
      const apply = (texture) => {
        if (!texture) return null;
        texture.wrapS = THREE3.RepeatWrapping;
        texture.wrapT = THREE3.RepeatWrapping;
        texture.repeat.x = 1;
        texture.repeat.y = 1 / scale.y;
        return texture;
      };
      if (maps.color) mat.map = apply(maps.color);
      if (maps.ao) mat.aoMap = apply(maps.ao);
      if (maps.normal) mat.normalMap = apply(maps.normal);
      if (maps.roughness) {
        mat.roughnessMap = apply(maps.roughness);
        mat.metalnessMap = mat.roughnessMap;
      }
    }
    return mat;
  }
  /**
   * Generates the geometry for the branches
   */
  createBranchesGeometry() {
    this.branchesMesh.geometry.dispose();
    this.branchesMesh.geometry = this.#buildBufferGeometry(this.branches);
    this.branchesMesh.material.dispose();
    this.branchesMesh.material = this.#createBarkMaterial();
    this.branchesMesh.castShadow = true;
    this.branchesMesh.receiveShadow = true;
  }
  /**
   * Creates the leaf material, including the wind sway vertex shader, from
   * the current options
   * @returns {THREE.MeshStandardMaterial}
   */
  #createLeafMaterial() {
    const mat = new THREE3.MeshStandardMaterial({
      name: "leaves",
      map: this.options.leaves.map ?? null,
      color: new THREE3.Color(this.options.leaves.tint),
      side: THREE3.DoubleSide,
      alphaTest: this.options.leaves.alphaTest,
      metalness: 0,
      roughness: 1,
      dithering: true
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uWindStrength = { value: new THREE3.Vector3(0.5, 0, 0.5) };
      shader.uniforms.uWindFrequency = { value: 0.5 };
      shader.uniforms.uWindScale = { value: 70 };
      shader.uniforms.uCustomNormals = { value: this.options.leaves.roundedNormals };
      shader.vertexShader = `
        uniform float uTime;
        uniform vec3 uWindStrength;
        uniform float uWindFrequency;
        uniform float uWindScale;
        ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        `void main() {`,
        `
        // GLSL Simplex Noise 3D
        // Source: https://github.com/ashima/webgl-noise

        vec3 mod289(vec3 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }

        vec4 mod289(vec4 x) {
            return x - floor(x * (1.0 / 289.0)) * 289.0;
        }

        vec4 permute(vec4 x) {
            return mod289(((x*34.0)+1.0)*x);
        }

        vec4 taylorInvSqrt(vec4 r) {
            return 1.79284291400159 - 0.85373472095314 * r;
        }

        vec3 fade(vec3 t) {
            return t*t*t*(t*(t*6.0-15.0)+10.0);
        }

        // Classic Simplex Noise 3D
        float simplex3(vec3 v) {
            const vec2  C = vec2(1.0/6.0, 1.0/3.0);
            const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

            // First corner
            vec3 i  = floor(v + dot(v, C.yyy) );
            vec3 x0 = v - i + dot(i, C.xxx);

            // Other corners
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );

            //  x0 = x0 - 0. + 0.0 * C 
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy; // 2.0 * C.x = 1/3 = C.y
            vec3 x3 = x0 - D.yyy;      // -1.0 + 3.0 * C.x = -0.5

            // Permutations
            i = mod289(i);
            vec4 p = permute( permute( permute( 
                        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                      + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                      + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

            // Gradients: 7x7 points over a square, mapped onto an octahedron.
            // The ring size 17*17 = 289 is close to the mapping's singularity.
            float n_ = 0.142857142857; // 1.0/7.0
            vec3  ns = n_ * D.wyz - D.xzx;

            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);

            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );

            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));

            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

            vec3 g0 = vec3(a0.xy,h.x);
            vec3 g1 = vec3(a0.zw,h.y);
            vec3 g2 = vec3(a1.xy,h.z);
            vec3 g3 = vec3(a1.zw,h.w);

            // Normalise gradients
            vec4 norm = taylorInvSqrt(vec4(dot(g0,g0), dot(g1,g1), dot(g2,g2), dot(g3,g3)));
            g0 *= norm.x;
            g1 *= norm.y;
            g2 *= norm.z;
            g3 *= norm.w;

            // Mix contributions from the four corners
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(g0,x0), dot(g1,x1), 
                                          dot(g2,x2), dot(g3,x3) ) );
        }
          
        void main() {`
      );
      shader.vertexShader = shader.vertexShader.replace(
        `#include <project_vertex>`,
        `
        vec4 mvPosition = vec4(transformed, 1.0);

        float windOffset = 2.0 * 3.14 * simplex3(mvPosition.xyz / uWindScale);
        vec3 windSway = uv.y * uWindStrength * (
          0.5 * sin(uTime * uWindFrequency + windOffset) +
          0.3 * sin(2.0 * uTime * uWindFrequency + 1.3 * windOffset) +
          0.2 * sin(5.0 * uTime * uWindFrequency + 1.5 * windOffset)
        );
        mvPosition.xyz += windSway;

        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
        `
      );
      shader.fragmentShader = `uniform bool uCustomNormals;
` + shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        THREE3.ShaderChunk.normal_fragment_begin.replace(
          "normal *= faceDirection;",
          "if (!uCustomNormals) { normal *= faceDirection; }"
        )
      );
      Object.defineProperty(mat.userData, "shader", {
        value: shader,
        configurable: true,
        enumerable: false
      });
    };
    return mat;
  }
  /**
   * Generates the geometry for the leaves
   */
  createLeavesGeometry() {
    this.leavesMesh.geometry.dispose();
    this.leavesMesh.geometry = this.#buildBufferGeometry(this.leaves);
    this.leavesMesh.material.dispose();
    this.leavesMesh.material = this.#createLeafMaterial();
    this.leavesMesh.castShadow = true;
    this.leavesMesh.receiveShadow = true;
  }
  /**
   * Create or update the trellis geometry
   */
  createTrellis() {
    if (this.trellisMesh) {
      this.remove(this.trellisMesh);
      this.trellisMesh.dispose();
      this.trellisMesh = null;
    }
    if (this.options.trellis.enabled && this.options.trellis.visible) {
      this.trellisMesh = new Trellis(this.options.trellis);
      this.trellisMesh.generate();
      this.add(this.trellisMesh);
    }
  }
  /**
   * Find the nearest point on the trellis grid to a given position
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3}
   */
  getNearestTrellisPoint(position) {
    const t = this.options.trellis;
    const trellisX = t.position.x;
    const trellisY = t.position.y;
    const trellisZ = t.position.z;
    const minX = trellisX - t.width / 2;
    const maxX = trellisX + t.width / 2;
    const minY = trellisY;
    const maxY = trellisY + t.height;
    const clampedX = Math.max(minX, Math.min(maxX, position.x));
    const clampedY = Math.max(minY, Math.min(maxY, position.y));
    const nearestHLineY = Math.round((clampedY - minY) / t.spacing) * t.spacing + minY;
    const finalHLineY = Math.max(minY, Math.min(maxY, nearestHLineY));
    const nearestVLineX = Math.round((clampedX - minX) / t.spacing) * t.spacing + minX;
    const finalVLineX = Math.max(minX, Math.min(maxX, nearestVLineX));
    const pointOnHLine = new THREE3.Vector3(clampedX, finalHLineY, trellisZ);
    const pointOnVLine = new THREE3.Vector3(finalVLineX, clampedY, trellisZ);
    const distH = position.distanceTo(pointOnHLine);
    const distV = position.distanceTo(pointOnVLine);
    return distH < distV ? pointOnHLine : pointOnVLine;
  }
  /**
   * Calculate the force vector toward the nearest trellis point
   * @param {THREE.Vector3} position Current section position
   * @param {number} radius Current section radius
   * @returns {{ direction: THREE.Vector3, strength: number } | null}
   */
  calculateTrellisForce(position, radius) {
    const trellis = this.options.trellis;
    const nearestPoint = this.getNearestTrellisPoint(position);
    const distance = position.distanceTo(nearestPoint);
    if (distance > trellis.force.maxDistance) return null;
    if (distance < 1e-3) return null;
    const direction = new THREE3.Vector3().subVectors(nearestPoint, position).normalize();
    const distanceFactor = 1 - Math.pow(
      distance / trellis.force.maxDistance,
      trellis.force.falloff
    );
    const strength = trellis.force.strength * distanceFactor / radius;
    return { direction, strength };
  }
  get vertexCount() {
    return (this.branches.verts.length + this.leaves.verts.length) / 3;
  }
  get triangleCount() {
    return (this.branches.indices.length + this.leaves.indices.length) / 3;
  }
};
export {
  Billboard,
  Tree,
  TreePreset,
  TreeType,
  Trellis
};
