import Layout from "@/components/Layout";
import ProductForm from "@/components/ProductForm";
import axios from "axios";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";

export default function EditProductPage() {
  const [productInfo, setProductInfo] = useState(null);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const router = useRouter();
  const { id } = router.query;
  const productId = Array.isArray(id) ? id[0] : id;

  useEffect(() => {
    if (!productId) return;
    let active = true;
    start();
    onFetch();

    axios
      .get(`/api/products?id=${productId}`)
      .then((res) => {
        onProcess();
        if (active) setProductInfo(res.data.data);
      })
      .finally(() => {
        complete();
      });

    return () => {
      active = false;
    };
  }, [productId, start, onFetch, onProcess, complete]);

  return (
    <Layout>
           {productInfo ? (
        <ProductForm key={productInfo._id} {...productInfo} />
      ) : (
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="md" text="Loading product..." progress={progress} />
        </div>
      )}
    </Layout>
  );
}
