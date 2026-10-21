# Domain rules

- Follow the package contributor rules in ../../../AGENTS.md.
- Keep entry modules limited to assembling public exports.
- Preserve public signatures, evaluation order and observable errors.
- Keep each operation separate from shared data and types.
- Keep the existing esbuild artifact entry bundled into one self-contained dist file.
- Keep artifact integrity checks based on the executing file and projected policy bytes.
