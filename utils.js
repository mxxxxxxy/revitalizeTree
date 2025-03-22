
export function calculateImageSize(path, targetWidth = null, targetHeight = null) {
    return new Promise((resolve, reject) => {
        // 创建一个新的图片对象
        const img = new Image();
        img.src = path;
        // 监听图片加载完成事件
        img.onload = () => {
            // 获取图片原始宽度和高度
            const originalWidth = img.width;
            const originalHeight = img.height;

            let newWidth, newHeight;

            // 根据给定的目标宽度或高度计算保持宽高比后的尺寸
            if (targetWidth && !targetHeight) {
                newWidth = targetWidth;
                newHeight = (originalHeight / originalWidth) * targetWidth;
            } else if (!targetWidth && targetHeight) {
                newHeight = targetHeight;
                newWidth = (originalWidth / originalHeight) * targetHeight;
            } else if (targetWidth && targetHeight) {
                console.warn("仅支持指定目标宽度或目标高度之一，未处理同时指定的情况。");
                newWidth = targetWidth;
                newHeight = (originalHeight / originalWidth) * targetWidth;
            } else {
                newWidth = originalWidth;
                newHeight = originalHeight;
            }

            resolve({
                originalWidth,
                originalHeight,
                newWidth: Math.round(newWidth), // 保留到整数
                newHeight: Math.round(newHeight),
            });
        };

        // 监听图片加载错误事件
        img.onerror = (error) => {
            reject("图片加载失败，请检查文件来源！");
        };
    });
}



export function getImageData(imagePath) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            resolve(imageData);
        };
        img.onerror = reject;
        img.src = imagePath;
    })
}

export function loadImg(imgSrc){
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.src = imgSrc;
        image.onload = () => resolve(image); // 图片加载成功
        image.onerror = (err) => reject(err); // 图片加载失败
    });
}
  
  