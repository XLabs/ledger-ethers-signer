import {LedgerSigner} from "../src";
import {JsonRpcProvider} from "ethers";


async function main() {
  const provider = new JsonRpcProvider("https://rpc.sepolia.org", undefined, {
    staticNetwork: true
  });
  const derivationPath = "m/44'/60'/0'/0/0";
  const signer = await LedgerSigner.create(provider, derivationPath);

  // get sender address for simple transfer
  const address = await signer.getAddress();
  console.log(`Address: ${address}`);

  const destinationAddress = address;

  // create and sign transfer transaction
  const tx = await signer.sendTransaction(
    {
      to: destinationAddress,
      value: 10,
    }
  );
  console.log(`Transaction ${tx.hash} sent`);

  const receipt = await tx.wait();
  if (receipt?.status !== 1) {
    throw new Error("Transfer failed");
  }
  console.log(`Transaction ${tx.hash} is successful`);
};

main();