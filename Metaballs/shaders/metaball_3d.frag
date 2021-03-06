#version 300 es

/** The maximum number of charges that can be passed to this shader. */
#define MAX_CHARGES 64

#define INF 1.0 / 0.0
#define EPSILON 0.01
#define MAX_REFLECTIONS 2

/** The intersection types. */
#define INTERSECTION_ENTRY
#define INTERSECTION_ENTRANCE

#extension GL_EXT_gpu_shader5 : enable
#extension GL_ARB_shader_bit_encoding : enable

/** Container for charges, may not be full. */
uniform highp vec4 charges[MAX_CHARGES];

/** The actual number of charges. */
uniform int charge_count;

/** The threshold charge for a meta surface. */
uniform highp float threshold;

uniform highp mat4 camera_matrix;
uniform highp vec3 camera_origin;

layout(location=0) out highp vec4 frag_color;

/**
 * Calculates the intersections with the given charge sphere.
 *
 * @param ro The origin of the cast ray.
 * @param dir The direction of the cast ray.
 * @param index The index of the charge sphere to intersect.
 * @param intersections The structures for storing the intersection results.
 * @return The number of intersections found.
 */
int findSphereIntersection(
		in vec3 ro,
		in vec3 dir,
		in int index,
		out float roots[2]) {
	highp vec3 fc = ro - charges[index].xyz;

	highp float a = dot(dir, dir);
	highp float b = 2.0 * dot(fc, dir);
	highp float c = dot(fc, fc) - charges[index].w*charges[index].w;

	if (a == 0.0) {
		if (b == 0.0) {
			return 0;
		} else {
			roots[0] = -c / b;
			return 1;
		}
	} else {
		highp float det = b*b - 4.0 * a*c;
		if (det <= 0.0) {
			return 0;
		} else {
			highp float q = -(b + sign(b)*sqrt(det)) / 2.0;
			roots[0] = q / a;

			if (q != 0.0) {
				roots[1] = c / q;
			} else {
				roots[1] = roots[0];
			}
			return 2;
		}
	}
	return 0;
}

highp float calculateCharge(in highp float distance, in highp float charge_radius) {
	highp float r = distance / charge_radius;
	if (r > 1.0) {
		return 0.0;
	}

	return 1.0 - r*r*r * (r * (r * 6.0 - 15.0) + 10.0);
}

bool findIntersection(in vec3 ro, in vec3 rd, out vec3 pos, out vec3 normal) {
	// Find intersection with the ray and the metaball spheres.
	// The charge function we use = 0 for dist > charge radius
	// so we can ignore charges which fall outside this range.
	int active_charges[MAX_CHARGES];
	int intersection_count = 0;

	// Keep track of the min and max t values so we only have to
	// iterate between the two points these define.
	// TODO(orglofch): Store all intersections and their type
	// E.g. ENTER, EXIT, so we can skip gaps between influence spheres.
	highp float min_t = INF;
	highp float max_t = 0.0;

	for (int i = 0; i < charge_count; ++i) {
		highp float roots[2];
		int num_roots = findSphereIntersection(ro, rd, i, roots);
		if (num_roots > 0) {
			active_charges[intersection_count++] = i;
			if (num_roots >= 1 && roots[0] > 0.0) {
				max_t = max(max_t, roots[0]);
				min_t = min(min_t, roots[0]);
			}
			if (num_roots == 2 && roots[1] > 0.0) {
				max_t = max(max_t, roots[1]);
				min_t = min(min_t, roots[1]);
			}
		}
	}

	if (intersection_count == 0) {
		return false;
	}

	// Ray march between [min_t, max_t] to approximate if this
	// ray ever intersects a meta surface.
	highp float cur_t = min_t;
	while (cur_t < max_t) {
		pos = ro + rd * cur_t;
		highp float step_charge = 0.0;
		for (int i = 0; i < intersection_count; ++i) {
			highp vec4 metaball = charges[active_charges[i]];
			highp float dist = distance(metaball.xyz, pos);
			step_charge += calculateCharge(dist, metaball.w);
		}
		// TODO(orglofch): This can early exit in the loop, but it messes
		// up the color function due to not having full charge sum.
		if (step_charge >= 0.4) {
			normal = vec3(0, 0, 0);
			// Add normals for each metaball based on their contribution.
			for (int i = 0; i < intersection_count; ++i) {
				highp vec4 metaball = charges[active_charges[i]];
				highp vec3 from_center = pos - metaball.xyz;
				highp float dist = length(from_center);
				highp float charge = calculateCharge(dist, metaball.w);
				if (charge > 0.0) {
					normal += normalize(from_center) * (charge / step_charge);
				}
			}
			normal = normalize(normal);
			return true;
		}
		// Take larger steps the lower our step charge
		// (the farther we are from the meta surface)
		highp float step = step_charge;
		cur_t += 0.5;//1.0 - 0.9 * step*step*step * (step * (step * 6.0 - 15.0) + 10.0);
	}
	return false;
}

highp vec3 ambient = vec3(0.025, 0.025, 0.05);

highp vec3 colourForIntersection(in vec3 rd, in vec3 pos, in vec3 normal) {
	highp vec3 light_pos = vec3(0, 0, -600);
	highp vec3 light_dir = normalize(light_pos - pos);

	highp vec3 colour = ambient;

	highp vec3 l_pos, l_normal;
	if (!findIntersection(light_pos, -1.0 * light_dir, l_pos, l_normal)
			|| distance(light_pos, l_pos) >= distance(light_pos, pos) - 6.0) {
		highp float shininess = 200.0;

		highp float lambertian = max(dot(light_dir, normal), 0.0);
		highp float specular = 0.0;
		if (lambertian > 0.0) {
			highp vec3 refl_dir = reflect(-light_dir, normal);
			highp float spec_angle = max(dot(refl_dir, -rd), 0.0);
			specular = pow(spec_angle, shininess/4.0);
		}

		colour += lambertian * vec3(0.25, 0.25, 0.5)
			+ specular * vec3(1.0, 1.0, 1.0);
	}
	return colour;
}

void main()
{
	highp vec3 pixel_in_world = (vec4(gl_FragCoord.xy, 0, 1) * camera_matrix).xyz;

	highp vec3 ro = camera_origin;
	highp vec3 rd = normalize(pixel_in_world - camera_origin);

	highp vec3 final_colour = vec3(0, 0, 0);
	highp float colour_frac = 1.0;
	highp vec3 pos, normal;
	for (int i = 0; i < MAX_REFLECTIONS + 1; ++i) {
		if (!findIntersection(ro, rd, pos, normal)) {
			break;
		}
		// float base = 0.1 + (abs(pos.z) * 0.05); // Lines
		// float base = 0.1 + (dot(camera_origin, normal) * 1); // Grain
		// float base = dot(camera_origin, rd * 0.1); // Screen sphere
		highp float base = normal.z;
		// float cell = (int(base * 100) % 16)/3.0;
		highp float cell = float(int(base * 20.0) % 2);
		highp vec3 colour = vec3(cell);
		// vec3 colour = vec3(1- cell, 1 - cell, 1);
		// vec3 colour = colourForIntersection(rd, pos, normal);
		final_colour += colour * colour_frac;

		// Set parameters for next iteration.
		colour_frac = colour_frac * 0.2;
		ro = pos + normal;
		rd = normalize(reflect(rd, normal));
	}
	// final_colour *= vec3(min(pos.x, 1.0), min(pos.y, 1.0), min(-pos.z, 1.0)) * 0.1;
	frag_color = vec4(final_colour, 1);
}