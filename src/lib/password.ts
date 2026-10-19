import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const scryptCost = 32_768;
const scryptBlockSize = 8;
const scryptParallelization = 1;
const saltBytes = 16;
const derivedKeyBytes = 64;

function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      derivedKeyBytes,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: 64 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 4) {
    throw new Error("Passwords must be at least 4 characters long.");
  }

  const salt = randomBytes(saltBytes);
  const derivedKey = await deriveKey(
    password,
    salt,
    scryptCost,
    scryptBlockSize,
    scryptParallelization,
  );

  return [
    "scrypt",
    scryptCost,
    scryptBlockSize,
    scryptParallelization,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  const [algorithm, rawCost, rawBlockSize, rawParallelization, rawSalt, rawKey] =
    passwordHash.split("$");

  const cost = Number(rawCost);
  const blockSize = Number(rawBlockSize);
  const parallelization = Number(rawParallelization);

  if (
    algorithm !== "scrypt" ||
    !Number.isInteger(cost) ||
    cost < 16_384 ||
    cost > 262_144 ||
    (cost & (cost - 1)) !== 0 ||
    !Number.isInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > 16 ||
    !Number.isInteger(parallelization) ||
    parallelization < 1 ||
    parallelization > 4 ||
    !rawSalt ||
    !rawKey
  ) {
    return false;
  }

  const salt = Buffer.from(rawSalt, "base64url");
  const expectedKey = Buffer.from(rawKey, "base64url");
  if (salt.length !== saltBytes || expectedKey.length !== derivedKeyBytes) {
    return false;
  }

  const actualKey = await deriveKey(
    password,
    salt,
    cost,
    blockSize,
    parallelization,
  );
  return timingSafeEqual(actualKey, expectedKey);
}

export async function performDummyPasswordCheck(password: string): Promise<void> {
  await deriveKey(
    password,
    Buffer.alloc(saltBytes),
    scryptCost,
    scryptBlockSize,
    scryptParallelization,
  );
}
