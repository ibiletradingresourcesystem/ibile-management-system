import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import ProductForm from "@/components/ProductForm";

export default function Products() {
  const router = useRouter();
  // ?name= starts the form with that name (a market item bought before it was in the system).
  // The form reads its starting values once, so it waits for the address to be read.
  const name = router.isReady && typeof router.query.name === "string" ? router.query.name.slice(0, 120) : "";
  return (
    <Layout>
      <ProductForm key={router.isReady ? "ready" : "loading"} name={name} />
    </Layout>
  );
}
