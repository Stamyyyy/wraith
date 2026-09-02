/* Small, dependency-free math expression parser/evaluator.
   Deliberately not using eval() — this runs on whatever the user types,
   and a hand-rolled recursive-descent parser has zero code-injection
   surface, unlike eval() on arbitrary text. Supports + - * / ^ %,
   parentheses, unary minus, functions (sin cos tan sqrt abs log ln exp
   floor ceil round), and constants (pi, e), plus a variable "x" for
   graphing. */
(function (global) {
  const FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sqrt: Math.sqrt, abs: Math.abs,
    log: Math.log10, ln: Math.log, exp: Math.exp,
    floor: Math.floor, ceil: Math.ceil, round: Math.round
  };
  const CONSTS = { pi: Math.PI, e: Math.E };

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let n = '';
        while (i < src.length && /[0-9.]/.test(src[i])) { n += src[i]; i++; }
        tokens.push({ type: 'num', value: parseFloat(n) });
        continue;
      }
      if (/[a-zA-Z]/.test(c)) {
        let n = '';
        while (i < src.length && /[a-zA-Z]/.test(src[i])) { n += src[i]; i++; }
        tokens.push({ type: 'ident', value: n });
        continue;
      }
      if ('+-*/^%()'.includes(c)) {
        tokens.push({ type: 'op', value: c });
        i++;
        continue;
      }
      throw new Error('Unexpected character: ' + c);
    }
    return tokens;
  }

  function parse(tokens) {
    let pos = 0;
    function peek() { return tokens[pos]; }
    function next() { return tokens[pos++]; }

    function parseExpr() { return parseAddSub(); }

    function parseAddSub() {
      let left = parseMulDiv();
      while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
        const op = next().value;
        const right = parseMulDiv();
        left = op === '+' ? left + right : left - right;
      }
      return left;
    }

    function parseMulDiv() {
      let left = parseUnary();
      while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
        const op = next().value;
        const right = parseUnary();
        if (op === '*') left = left * right;
        else if (op === '/') left = left / right;
        else left = left % right;
      }
      return left;
    }

    function parseUnary() {
      if (peek() && peek().type === 'op' && peek().value === '-') {
        next();
        return -parseUnary();
      }
      if (peek() && peek().type === 'op' && peek().value === '+') {
        next();
        return parseUnary();
      }
      return parsePow();
    }

    function parsePow() {
      let base = parseAtom();
      if (peek() && peek().type === 'op' && peek().value === '^') {
        next();
        const exp = parseUnary(); // right-associative, allows -2^-2
        base = Math.pow(base, exp);
      }
      return base;
    }

    function parseAtom() {
      const t = peek();
      if (!t) throw new Error('Unexpected end of expression');
      if (t.type === 'num') { next(); return t.value; }
      if (t.type === 'op' && t.value === '(') {
        next();
        const v = parseExpr();
        if (!peek() || peek().value !== ')') throw new Error('Missing closing parenthesis');
        next();
        return v;
      }
      if (t.type === 'ident') {
        next();
        const name = t.value.toLowerCase();
        if (peek() && peek().type === 'op' && peek().value === '(') {
          next();
          const arg = parseExpr();
          if (!peek() || peek().value !== ')') throw new Error('Missing closing parenthesis');
          next();
          if (!(name in FUNCS)) throw new Error('Unknown function: ' + name);
          return FUNCS[name](arg);
        }
        if (name === 'x') return global.__mathexpr_x ?? 0;
        if (name in CONSTS) return CONSTS[name];
        throw new Error('Unknown identifier: ' + name);
      }
      throw new Error('Unexpected token: ' + t.value);
    }

    const result = parseExpr();
    if (pos < tokens.length) throw new Error('Unexpected trailing input: ' + tokens[pos].value);
    return result;
  }

  function evaluate(src, xValue) {
    if (xValue !== undefined) global.__mathexpr_x = xValue;
    const tokens = tokenize(src);
    if (!tokens.length) throw new Error('Empty expression');
    return parse(tokens);
  }

  const api = { evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.MathExpr = api;
})(typeof window !== 'undefined' ? window : globalThis);
