function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function drawPseudoQr(canvas, token) {
  if (!canvas) {
    return;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  const modules = 25;
  const cell = canvas.width / modules;
  const grid = Array.from({ length: modules }, () => Array(modules).fill(0));
  const fixed = Array.from({ length: modules }, () => Array(modules).fill(false));

  const markFinder = (originX, originY) => {
    for (let y = -1; y <= 7; y += 1) {
      for (let x = -1; x <= 7; x += 1) {
        const targetX = originX + x;
        const targetY = originY + y;
        if (targetX < 0 || targetY < 0 || targetX >= modules || targetY >= modules) {
          continue;
        }
        fixed[targetY][targetX] = true;
        if (x < 0 || y < 0 || x > 6 || y > 6) {
          grid[targetY][targetX] = 0;
          continue;
        }
        const border = x === 0 || x === 6 || y === 0 || y === 6;
        const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        grid[targetY][targetX] = border || center ? 1 : 0;
      }
    }
  };

  markFinder(0, 0);
  markFinder(modules - 7, 0);
  markFinder(0, modules - 7);

  for (let index = 8; index < modules - 8; index += 1) {
    fixed[6][index] = true;
    grid[6][index] = index % 2 === 0 ? 1 : 0;
    fixed[index][6] = true;
    grid[index][6] = index % 2 === 0 ? 1 : 0;
  }

  let randomState = hashToken(token) || 1;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    randomState >>>= 0;
    return randomState / 4294967296;
  };

  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (!fixed[y][x]) {
        grid[y][x] = random() > 0.52 ? 1 : 0;
      }
    }
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#08111f';

  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (grid[y][x]) {
        context.fillRect(
          Math.round(x * cell),
          Math.round(y * cell),
          Math.ceil(cell),
          Math.ceil(cell),
        );
      }
    }
  }
}
