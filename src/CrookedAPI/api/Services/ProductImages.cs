namespace Crooked.Services
{
    // Uploaded product photos are saved in wwwroot/images/products. On Railway a volume is
    // mounted there so uploads survive redeploys, but the volume hides the photos built into
    // the image (the ones committed to git). The Dockerfile keeps a copy of those in
    // product-images, and RestoreBuiltIn copies any that are missing into the volume.
    public static class ProductImages
    {
        public static void RestoreBuiltIn(string contentRoot)
        {
            var builtIn = Path.Combine(contentRoot, "product-images");
            if (!Directory.Exists(builtIn)) return; // only exists in the Docker image

            var folder = Path.Combine(contentRoot, "wwwroot", "images", "products");
            Directory.CreateDirectory(folder);

            var restored = 0;
            foreach (var file in Directory.GetFiles(builtIn))
            {
                var target = Path.Combine(folder, Path.GetFileName(file));
                if (File.Exists(target)) continue;
                File.Copy(file, target);
                restored++;
            }

            if (restored > 0) Console.WriteLine($"Restored {restored} built-in product image(s) into {folder}.");
        }
    }
}
