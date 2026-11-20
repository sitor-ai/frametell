/* _test-kit: one component of the style's own, for the tests. */
(function () {
  const B = window.Builder.prototype;
  /** presenter(x, y, o): a plain stand-in figure */
  B.presenter = function (x, y, o = {}) {
    return this.rect ? this.rect(x, y, o.size || 100, o.size || 100) : this;
  };
})();
