import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  ContractLineage,
  SkillAudit,
  SkillBundleAudit,
  SkillConfig,
} from "./types.js";

export interface PreparedSkills {
  audit: SkillAudit;
  environment: NodeJS.ProcessEnv | undefined;
  patchPath: string | undefined;
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function emptyAudit(): SkillAudit {
  return {
    isolated: false,
    enabled: false,
    invocation: null,
    sourceRoot: null,
    stagedRoot: null,
    patchPath: null,
    patchSha256: null,
    bundles: [],
    verified: true,
    violations: [],
  };
}

function parseFrontmatter(content: string, path: string): Record<string, unknown> {
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") {
    throw new Error(`Skill must start with YAML frontmatter: ${path}`);
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error(`Skill frontmatter is not closed: ${path}`);
  const parsed = parseYaml(lines.slice(1, end).join("\n"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Skill frontmatter must be a YAML object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

interface BundleFile {
  absolutePath: string;
  relativePath: string;
}

async function listBundleFiles(bundlePath: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Skill bundles cannot contain symbolic links: ${absolutePath}`);
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new Error(`Skill bundles can contain only regular files: ${absolutePath}`);
      }
      files.push({
        absolutePath,
        relativePath: relative(bundlePath, absolutePath).split(sep).join("/"),
      });
    }
  };

  await visit(bundlePath);
  return files;
}

async function hashBundle(files: BundleFile[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of files) {
    const content = await readFile(file.absolutePath);
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(String(content.length), "utf8");
    hash.update("\0");
    hash.update(content);
  }
  return hash.digest("hex");
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function prepareBundle(
  sourceRoot: string,
  stagedRoot: string,
  name: string,
): Promise<SkillBundleAudit> {
  const unresolvedBundlePath = join(sourceRoot, name);
  const unresolvedMetadata = await lstat(unresolvedBundlePath);
  if (unresolvedMetadata.isSymbolicLink()) {
    throw new Error(`Skill bundle cannot be a symbolic link: ${unresolvedBundlePath}`);
  }
  if (!unresolvedMetadata.isDirectory()) {
    throw new Error(`Skill bundle must be a directory: ${unresolvedBundlePath}`);
  }
  const sourcePath = await realpath(unresolvedBundlePath);
  if (!isInside(sourceRoot, sourcePath)) {
    throw new Error(`Skill bundle resolves outside its configured root: ${sourcePath}`);
  }

  const skillPath = join(sourcePath, "SKILL.md");
  const skillMetadata = await lstat(skillPath);
  if (!skillMetadata.isFile() || skillMetadata.isSymbolicLink()) {
    throw new Error(`Skill bundle must contain a regular SKILL.md: ${skillPath}`);
  }
  const frontmatter = parseFrontmatter(await readFile(skillPath, "utf8"), skillPath);
  if (frontmatter.name !== name) {
    throw new Error(`Skill frontmatter name must equal ${name}: ${skillPath}`);
  }
  if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") {
    throw new Error(`Skill frontmatter description must be a non-empty string: ${skillPath}`);
  }

  const files = await listBundleFiles(sourcePath);
  const sha256 = await hashBundle(files);
  const stagedPath = join(stagedRoot, name);
  await cp(sourcePath, stagedPath, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
  });
  const stagedFiles = await listBundleFiles(stagedPath);
  if ((await hashBundle(stagedFiles)) !== sha256) {
    throw new Error(`Staged Skill bundle hash does not match its source: ${name}`);
  }

  return { name, sourcePath, sha256, fileCount: files.length };
}

export async function prepareSkills(
  config: SkillConfig | undefined,
  lineage: ContractLineage,
  repository: string,
  worktree: string,
  artifactDirectory: string,
): Promise<PreparedSkills> {
  if (config === undefined) {
    const environment = { ...process.env };
    delete environment.DSH_BUNDLED_SKILL_DIR;
    return { audit: emptyAudit(), environment, patchPath: undefined };
  }

  const repositoryPath = await realpath(repository);
  const worktreePath = await realpath(worktree);
  const stagedRoot = join(artifactDirectory, "skills");
  await mkdir(stagedRoot, { recursive: false });
  const bundles: SkillBundleAudit[] = [];
  let sourceRoot: string | null = null;
  if (config.names.length > 0) {
    if (config.root === undefined) throw new Error("Skill root is required when names are configured");
    const unresolvedRoot = resolve(dirname(lineage.rootContractPath), config.root);
    const unresolvedMetadata = await lstat(unresolvedRoot);
    if (unresolvedMetadata.isSymbolicLink()) {
      throw new Error(`Skill root cannot be a symbolic link: ${unresolvedRoot}`);
    }
    if (!unresolvedMetadata.isDirectory()) {
      throw new Error(`Skill root must be a directory: ${unresolvedRoot}`);
    }
    sourceRoot = await realpath(unresolvedRoot);
    if (isInside(repositoryPath, sourceRoot)) {
      throw new Error(`Skill root must be stored outside the target repository: ${sourceRoot}`);
    }
    if (isInside(worktreePath, sourceRoot)) {
      throw new Error(`Skill root must be stored outside the execution worktree: ${sourceRoot}`);
    }
    for (const name of config.names) {
      bundles.push(await prepareBundle(sourceRoot, stagedRoot, name));
    }
  }

  const patchPath = join(artifactDirectory, "skills.patch.yml");
  await writeFile(
    patchPath,
    stringifyYaml([
      {
        id: "skill-filesystem",
        config: {
          includeDefaultRoots: false,
          customSkillDirs: [stagedRoot],
        },
      },
    ]),
    "utf8",
  );
  const patchSha256 = await hashFile(patchPath);

  return {
    audit: {
      isolated: true,
      enabled: bundles.length > 0,
      invocation: config.invocation,
      sourceRoot,
      stagedRoot,
      patchPath,
      patchSha256,
      bundles,
      verified: false,
      violations: [],
    },
    environment: {
      ...process.env,
      DSH_BUNDLED_SKILL_DIR: stagedRoot,
    },
    patchPath,
  };
}

export async function verifySkillProjection(audit: SkillAudit): Promise<string[]> {
  if (!audit.isolated) return [];
  if (audit.stagedRoot === null || audit.patchPath === null || audit.patchSha256 === null) {
    return ["Skill projection audit is incomplete."];
  }

  const violations: string[] = [];
  try {
    if ((await hashFile(audit.patchPath)) !== audit.patchSha256) {
      violations.push("Generated Skill patch changed during Harness execution.");
    }
  } catch (error) {
    violations.push(`Generated Skill patch could not be verified: ${(error as Error).message}`);
  }

  try {
    const actualNames = (await readdir(audit.stagedRoot)).sort();
    const expectedNames = audit.bundles.map((bundle) => bundle.name).sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      violations.push("Staged Skill root members changed during Harness execution.");
    }
  } catch (error) {
    violations.push(`Staged Skill root could not be verified: ${(error as Error).message}`);
  }

  for (const bundle of audit.bundles) {
    try {
      const files = await listBundleFiles(join(audit.stagedRoot, bundle.name));
      if (files.length !== bundle.fileCount || (await hashBundle(files)) !== bundle.sha256) {
        violations.push(`Staged Skill bundle changed during Harness execution: ${bundle.name}`);
      }
    } catch (error) {
      violations.push(
        `Staged Skill bundle could not be verified (${bundle.name}): ${(error as Error).message}`,
      );
    }
  }
  return violations;
}
