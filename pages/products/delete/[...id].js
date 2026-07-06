import Layout from "@/components/Layout";
import axios from "axios";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { showAlertDialog } from "@/lib/dialogs";

export default function DeleteProductPage() {
  const router = useRouter();
  const [productInfo, setProductInfo] = useState();
  const { id } = router.query;

  useEffect(() => {
    if (!id) return;
    axios.get("/api/products?id=" + id).then((res) => {
      setProductInfo(res.data?.data || res.data);
    });
  }, [id]);

  function goBack() {
    router.push("/manage/products");
  }

  async function handleDelete() {
    try {
      await axios.delete(`/api/products?id=`+id);
      goBack();
    } catch (error) {
      console.error("Failed to delete product:", error);
      await showAlertDialog({
        title: "Archive failed",
        message: "Failed to delete product. Please try again.",
        tone: "danger",
      });
    }
  }

  return (
    <Layout>
     <div className="flex items-center justify-center items-center min-h-full">
        <div className="bg-white shadow-lg rounded-lg p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-semibold text-gray-800 mb-4">
            Confirm Product Deletion
          </h1>
          <p className="text-gray-600 mb-8">
            Are you sure you want to archive <strong>{productInfo?.name}</strong>?
          </p>
          <div className="flex justify-center gap-4">
            <button
              onClick={handleDelete}
              className="py-2 px-6 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 transition duration-300"
            >
              Yes, Archive
            </button>
            <button
              onClick={goBack}
              className="py-2 px-6 bg-gray-300 text-gray-700 font-medium rounded-md hover:bg-gray-400 transition duration-300"
            >
              No, Cancel
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
