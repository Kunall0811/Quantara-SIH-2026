# Advanced Analytics

## Route Resilience

Resilience is computed from actual base route metrics under declared scenario models. A scenario is successful when its composite delay/risk measure remains below the configured threshold.

Outputs:
- resilience score
- scenario success rate
- expected delay
- worst-case delay
- per-scenario modeled impact

All scenario results are labelled `SIMULATED`.

## Route Regret

For a selected route and one or more alternatives:

`regret = selected-route performance under scenario - best-alternative performance under the same scenario`

The current implementation reports the modeled duration regret in minutes.

## Counterfactual Analysis

The system compares:
- modeled performance without re-optimization
- supplied measured/optimized performance after re-optimization

It reports delay, fuel-cost and CO2 differences. These are not presented as field-proven savings.

## Time-window risk

Statuses:
- SAFE
- AT RISK
- LIKELY VIOLATION
- VIOLATED

Risk is derived from the delivery arrival time and declared ready/due window.

## Route DNA

Route DNA is a deterministic SHA-256 fingerprint over algorithm, seed, route metrics, resilience/regret and objective weights. This makes an optimization result traceable without pretending the identifier contains semantic information.

## Actual vs predicted

The endpoint computes:
- ETA error
- distance error
- traffic prediction error
- absolute errors

Inputs labelled `MEASURED` must come from actual observations.
