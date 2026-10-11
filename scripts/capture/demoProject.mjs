// Demo project for the site's BLine scene, captured in the real 2027 beta editor.
// Illustrative paths on the REBUILT 2026 field (blue alliance), not any team's autos.
// Coordinates are field meters: x toward the red wall, y up from the bottom rail.
//
// Paths that use a trench stay low in the trench lane (y ≈ 0.7 or 7.35) until they are past the bump
// (x < 4), then turn. The launch film's "Center Sweep" and "Steal Center" cut diagonally across the bump.

const deg = (d) => (d * Math.PI) / 180;

// Radii start generator-owned so "Generate" visibly chooses them on camera.
const autoRadius = { intermediate_handoff_radius_meters: 0.3, handoff_radius_source: "auto" };

const waypoint = (x, y, headingDeg) => ({
  type: "waypoint",
  translation_target: { x_meters: x, y_meters: y, ...autoRadius },
  rotation_target: { rotation_radians: deg(headingDeg), profiled_rotation: true },
});
const translation = (x, y) => ({ type: "translation", x_meters: x, y_meters: y, ...autoRadius });
const rotation = (t, headingDeg) => ({ type: "rotation", t_ratio: t, rotation_radians: deg(headingDeg), profiled_rotation: true });
const event = (t, key) => ({ type: "event_trigger", t_ratio: t, lib_key: key });

/** The Simulate take starts from this single start point and sketches the rest with the Curve tool. */
export const startPoint = waypoint(3.0, 7.35, 0);

/** The hero path, placed point by point in the "build" take. Order = placement order. */
export const heroPoints = [
  [3.55, 7.35, "1"],
  [5.9, 7.35, "2"],
  [7.75, 6.3, "2"],
  [7.75, 2.0, "2"],
  [5.9, 0.7, "2"],
  [3.4, 0.7, "2"],
  [3.0, 2.3, "1"],
];

export const demoPaths = {
  "Center Sweep": [
    waypoint(3.55, 7.35, 0),
    translation(5.9, 7.35),
    event(0.5, "intake"),
    translation(7.75, 6.3),
    rotation(0.5, -90),
    translation(7.75, 2.0),
    translation(5.9, 0.7),
    event(0.5, "stopIntake"),
    translation(3.4, 0.7),
    waypoint(3.0, 2.3, 35),
  ],
  "Depot Run": [
    waypoint(3.55, 5.6, 180),
    translation(1.6, 6.0),
    event(0.5, "intake"),
    waypoint(0.75, 5.95, 180),
    waypoint(2.55, 4.55, 0),
  ],
  "Outpost Feed": [
    waypoint(3.55, 2.45, 180),
    translation(1.7, 1.2),
    waypoint(0.75, 0.75, 180),
    event(0.5, "shoot"),
    waypoint(2.7, 3.1, 20),
  ],
  "Steal Center": [
    waypoint(3.55, 0.7, 0),
    translation(5.9, 0.7),
    translation(8.9, 1.4),
    event(0.4, "intake"),
    translation(8.9, 3.3),
    translation(5.9, 0.7),
    translation(3.4, 0.7),
    waypoint(3.0, 2.3, 35),
  ],
  "Steal Top": [
    waypoint(3.55, 7.35, 0),
    translation(5.9, 7.35),
    translation(8.9, 6.65),
    event(0.4, "intake"),
    translation(8.9, 4.75),
    translation(5.9, 7.35),
    translation(3.4, 7.35),
    waypoint(3.0, 5.75, -35),
  ],
  "Tower Climb": [
    waypoint(3.0, 2.3, 35),
    translation(2.2, 3.1),
    rotation(0.6, 180),
    waypoint(1.4, 3.75, 180),
  ],
  "Tower Climb Top": [
    waypoint(3.0, 5.75, -35),
    translation(2.2, 4.95),
    rotation(0.6, 180),
    waypoint(1.4, 4.3, 180),
  ],
  "Depot Return": [
    waypoint(2.55, 4.55, 0),
    translation(3.4, 6.3),
    waypoint(3.55, 7.35, 0),
  ],
};

export const demoGroups = {
  "Sweep + Climb": ["Center Sweep", "Tower Climb"],
  "Depot Auto": ["Depot Run", "Depot Return", "Center Sweep"],
  "Outpost Auto": ["Outpost Feed", "Steal Center", "Tower Climb"],
  "Double Steal": ["Steal Top", "Tower Climb Top"],
  "Depot + Steal": ["Depot Run", "Depot Return", "Steal Top", "Tower Climb Top"],
  "Full Field": ["Center Sweep", "Steal Center", "Tower Climb"],
};

const fileName = (name) => `${name}.json`;

export function demoArchive({ paths = demoPaths, groups = demoGroups, name = "Rebel Autos" } = {}) {
  return {
    bline_project_schema_version: 1,
    project_id: "project-site-demo-2027",
    display_name: name,
    exported_at: "2026-10-10T12:00:00.000Z",
    config: {
      kinematic_constraints: {
        default_max_velocity_meters_per_sec: 4.5,
        default_max_acceleration_meters_per_sec2: 9.0,
        default_max_velocity_deg_per_sec: 540,
        default_max_acceleration_deg_per_sec2: 1440,
        default_end_translation_tolerance_meters: 0.03,
        default_end_rotation_tolerance_deg: 2.0,
        default_intermediate_handoff_radius_meters: 0.3,
      },
      gui: { robot: { length_meters: 0.85, width_meters: 0.85 } },
    },
    paths: Object.entries(paths).map(([display_name, path_elements]) => ({
      file_name: fileName(display_name),
      display_name,
      path: { path_elements },
    })),
    path_groups: Object.entries(groups).map(([display_name, members], index) => ({
      group_id: `group-site-${index + 1}`,
      display_name,
      path_file_names: members.map(fileName),
    })),
  };
}
