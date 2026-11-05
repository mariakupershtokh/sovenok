import { solveCorner } from "../solver.js";

self.onmessage = ({ data }) => {
  try {
    self.postMessage(
      solveCorner(data.columns, data.rows, {
        ratio: data.ratio,
        timeLimitMs: data.timeLimitMs,
      }),
    );
  } catch (error) {
    self.postMessage({ status: "error", message: error.message });
  }
};
