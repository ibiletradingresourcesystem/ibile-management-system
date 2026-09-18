/**
 * The sums behind the calculator on the product pricing card.
 *
 * Works the expression out by hand — tokenise, order the operators, then add up — rather than
 * handing the text to the browser to run, so a typed expression can never be anything but a sum.
 */

const OPERATORS = {
  "+": { precedence: 1, apply: (a, b) => a + b },
  "-": { precedence: 1, apply: (a, b) => a - b },
  "*": { precedence: 2, apply: (a, b) => a * b },
  "/": { precedence: 2, apply: (a, b) => (b === 0 ? null : a / b) },
};

/** Accepts the symbols a calculator keypad produces as well as the plain ones. */
function normalize(expression) {
  return String(expression ?? "")
    .replace(/[×✕✖]/g, "*")
    .replace(/[÷∕]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/,/g, "")
    .trim();
}

function tokenize(text) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === " ") {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let number = "";
      while (index < text.length && /[0-9.]/.test(text[index])) {
        number += text[index];
        index += 1;
      }
      if ((number.match(/\./g) || []).length > 1) return null;
      tokens.push({ type: "number", value: Number(number) });
      continue;
    }

    if (char in OPERATORS) {
      // A minus with nothing usable before it is a negative number, not a subtraction
      const previous = tokens[tokens.length - 1];
      const isSign = char === "-" && (!previous || previous.type === "operator" || previous.value === "(");
      if (isSign) {
        tokens.push({ type: "number", value: 0 });
      }
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }

    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }

    return null;
  }

  return tokens;
}

/**
 * @param {string} expression  e.g. "1272.92 + 327.08" or "6450 / 24"
 * @returns {{ value: number|null, error: string }} value is null when the sum cannot be worked out
 */
export function evaluateExpression(expression) {
  const text = normalize(expression);
  if (!text) return { value: null, error: "" };

  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return { value: null, error: "Check the sum" };

  // Shunting-yard: operators wait their turn by precedence, brackets jump the queue
  const output = [];
  const operators = [];

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token.value);
    } else if (token.type === "operator") {
      while (operators.length > 0) {
        const top = operators[operators.length - 1];
        if (top === "(" || OPERATORS[top].precedence < OPERATORS[token.value].precedence) break;
        output.push(operators.pop());
      }
      operators.push(token.value);
    } else if (token.value === "(") {
      operators.push("(");
    } else {
      while (operators.length > 0 && operators[operators.length - 1] !== "(") {
        output.push(operators.pop());
      }
      if (operators.pop() !== "(") return { value: null, error: "Brackets don't match" };
    }
  }

  while (operators.length > 0) {
    const operator = operators.pop();
    if (operator === "(") return { value: null, error: "Brackets don't match" };
    output.push(operator);
  }

  const stack = [];
  for (const item of output) {
    if (typeof item === "number") {
      stack.push(item);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) return { value: null, error: "Check the sum" };

    const result = OPERATORS[item].apply(left, right);
    if (result === null) return { value: null, error: "Cannot divide by zero" };
    stack.push(result);
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0])) return { value: null, error: "Check the sum" };

  return { value: stack[0], error: "" };
}

/** Trims the floating-point dust off a result without turning whole numbers into "12.00". */
export function formatCalculatorValue(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 10000) / 10000;
  return String(rounded);
}
