-- Kerbwell gate (fork addition, Kerbwell Sign): signer assertion replay store and gate sessions.

-- CreateTable
CREATE TABLE "KerbwellGateAssertion" (
    "jti" TEXT NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KerbwellGateAssertion_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "KerbwellGateSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "authTime" TIMESTAMP(3) NOT NULL,
    "acr" TEXT NOT NULL,
    "amr" TEXT[],
    "consentVersion" TEXT NOT NULL,
    "consentHash" TEXT NOT NULL,
    "idvRef" TEXT,
    "legalName" TEXT NOT NULL,
    "docKind" TEXT NOT NULL,
    "mode" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "cfCity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "KerbwellGateSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KerbwellGateAssertion_recipientId_idx" ON "KerbwellGateAssertion"("recipientId");

-- CreateIndex
CREATE INDEX "KerbwellGateAssertion_expiresAt_idx" ON "KerbwellGateAssertion"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "KerbwellGateSession_tokenHash_key" ON "KerbwellGateSession"("tokenHash");

-- CreateIndex
CREATE INDEX "KerbwellGateSession_recipientId_idx" ON "KerbwellGateSession"("recipientId");

-- CreateIndex
CREATE INDEX "KerbwellGateSession_expiresAt_idx" ON "KerbwellGateSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "KerbwellGateAssertion" ADD CONSTRAINT "KerbwellGateAssertion_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KerbwellGateSession" ADD CONSTRAINT "KerbwellGateSession_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
