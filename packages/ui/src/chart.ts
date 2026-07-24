// Register only the Chart.js pieces the cost chart uses, so tree-shaking keeps
// the baked-in bundle small.
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
} from "chart.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

// Shared dark-theme defaults matching the app tokens.
Chart.defaults.font.family = '"Geist Mono", ui-monospace, monospace';
Chart.defaults.font.size = 10;
Chart.defaults.color = "#606060";
