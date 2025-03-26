-- CreateTable
CREATE TABLE "IpCache" (
    "id" TEXT NOT NULL,
    "cidrBlock" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainCache" (
    "id" TEXT NOT NULL,
    "domainName" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IpCache_cidrBlock_key" ON "IpCache"("cidrBlock");

-- CreateIndex
CREATE INDEX "IpCache_cidrBlock_idx" ON "IpCache"("cidrBlock");

-- CreateIndex
CREATE UNIQUE INDEX "DomainCache_domainName_key" ON "DomainCache"("domainName");

-- CreateIndex
CREATE INDEX "DomainCache_domainName_idx" ON "DomainCache"("domainName");
