export function hashHex(value: string) {
  const parts = hashParts(value);
  return parts.map((part) => part.toString(16).padStart(8, "0")).join("");
}

function hashParts(value: string) {
  let first = 1779033703;
  let second = 3144134277;
  let third = 1013904242;
  let fourth = 2773480762;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = second ^ Math.imul(first ^ code, 597399067);
    second = third ^ Math.imul(second ^ code, 2869860233);
    third = fourth ^ Math.imul(third ^ code, 951274213);
    fourth = first ^ Math.imul(fourth ^ code, 2716044179);
  }

  first = Math.imul(third ^ (first >>> 18), 597399067);
  second = Math.imul(fourth ^ (second >>> 22), 2869860233);
  third = Math.imul(first ^ (third >>> 17), 951274213);
  fourth = Math.imul(second ^ (fourth >>> 19), 2716044179);

  return [
    (first ^ second ^ third ^ fourth) >>> 0,
    (second ^ first) >>> 0,
    (third ^ first) >>> 0,
    (fourth ^ first) >>> 0,
  ];
}
