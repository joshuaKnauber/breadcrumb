import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
} from "chart.js";

let registered = false;

/**
 * Registers only the Chart.js pieces the cost chart uses, so bundlers can drop
 * the rest.
 *
 * Called explicitly rather than run as a module side effect: this package
 * declares no side-effecting JS, so a bare `import "./chart.js"` is exactly the
 * kind of thing a bundler is entitled to delete — and did, leaving the chart to
 * fail at runtime with "category is not a registered scale".
 */
export function registerChart(): void {
  if (registered) return;
  registered = true;

  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);
  Chart.defaults.font.family = '"Geist Mono", ui-monospace, monospace';
  Chart.defaults.font.size = 10;
  Chart.defaults.color = "#606060";
}
