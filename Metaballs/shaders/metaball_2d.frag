#version 300 es

/** The maximum number of charges that can be passed to this shader. */
#define MAX_CHARGES 75

/** Container for charges, may not be full. */
uniform highp vec4 charges[MAX_CHARGES];

/** The actual number of charges. */
uniform int charge_count;

/** The threshold charge. */
uniform highp float threshold;

layout(location=0) out highp vec4 frag_color;

void main()
{
	highp float charge = 0.0;
	for (int i = 0; i < charge_count; ++i) {
		highp float dist = distance(charges[i].xy, gl_FragCoord.xy);
		if (dist == 0.0) {
			charge = threshold;
			break;
		}
		highp float r = dist / charges[i].w;
		charge += 1.0 / (r*r);
	}

	charge /= 1000.0;
	if (charge > 0.9) {
		charge = pow(charge, 3.0);
		frag_color = vec4(charge / 2.0, charge / 2.0, charge, 1.0);
	} else {
		frag_color = vec4(charge / 2.0, charge / 2.0, charge, 1.0);
	}
}