import path from "path";

export function isPathWithinRoots(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    if (resolvedTarget === resolvedRoot) {
      return true;
    }
    return resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
  });
}