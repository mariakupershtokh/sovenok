import {
  enumerateCornerRoutes,
  findCornerBoardSuggestions,
  findCornerRatioSuggestions,
  solveCorner,
} from "../solver.js";

self.onmessage = ({ data }) => {
  try {
    if (data.type === "suggest") {
      self.postMessage({
        type: "suggest",
        ...findCornerBoardSuggestions(data.ratio, { limit: data.limit }),
      });
      return;
    }
    if (data.type === "ratio-suggest") {
      self.postMessage({
        type: "ratio-suggest",
        ...findCornerRatioSuggestions(data.columns, data.rows, {
          limit: data.limit,
        }),
      });
      return;
    }
    if (data.type === "enumerate") {
      self.postMessage({
        type: "enumerate",
        ...enumerateCornerRoutes(data.columns, data.rows, {
          ratio: data.ratio,
          limit: data.limit,
        }),
      });
      return;
    }
    self.postMessage(
      solveCorner(data.columns, data.rows, {
        ratio: data.ratio,
        timeLimitMs: data.timeLimitMs,
      }),
    );
  } catch (error) {
    self.postMessage({ type: "error", status: "error", message: error.message });
  }
};
