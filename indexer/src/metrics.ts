const counters = {
  submitted: 0,
  iterations: 0,
};

export const stats = {
  get submitted() {
    return counters.submitted;
  },
  get iterations() {
    return counters.iterations;
  },
  incrementSubmitted() {
    counters.submitted += 1;
  },
  incrementIterations() {
    counters.iterations += 1;
  },
};

