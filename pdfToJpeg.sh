#!/bin/bash
# PDF to JPEG converter script for macOS Quick Action

for pdf_file in "$@"; do
    if [[ "${pdf_file}" == *.pdf ]] || [[ "${pdf_file}" == *.PDF ]]; then
        # Get the directory and filename without extension
        dir=$(dirname "$pdf_file")
        filename=$(basename "$pdf_file" .pdf)
        filename=$(basename "$filename" .PDF)

        # Create output directory for multi-page PDFs
        output_dir="${dir}/${filename}_jpeg"
        mkdir -p "$output_dir"

        # Get number of pages using sips
        page_count=$(mdls -name kMDItemNumberOfPages -raw "$pdf_file" 2>/dev/null)

        # Use macOS built-in tools (sips via Preview's CoreGraphics)
        # Convert each page using Python with Quartz (built into macOS)
        /usr/bin/python3 << EOF
import os
import sys
from Quartz import CGPDFDocumentCreateWithURL, CGPDFDocumentGetNumberOfPages
from CoreFoundation import CFURLCreateFromFileSystemRepresentation
import Quartz

def pdf_to_jpeg(pdf_path, output_dir):
    pdf_url = CFURLCreateFromFileSystemRepresentation(None, pdf_path.encode('utf-8'), len(pdf_path.encode('utf-8')), False)
    pdf_doc = CGPDFDocumentCreateWithURL(pdf_url)

    if pdf_doc is None:
        print(f"Could not open PDF: {pdf_path}")
        return

    num_pages = CGPDFDocumentGetNumberOfPages(pdf_doc)

    for page_num in range(1, num_pages + 1):
        page = Quartz.CGPDFDocumentGetPage(pdf_doc, page_num)
        if page is None:
            continue

        # Get page dimensions
        media_box = Quartz.CGPDFPageGetBoxRect(page, Quartz.kCGPDFMediaBox)

        # Scale factor for good quality (2x)
        scale = 2.0
        width = int(media_box.size.width * scale)
        height = int(media_box.size.height * scale)

        # Create bitmap context
        color_space = Quartz.CGColorSpaceCreateDeviceRGB()
        context = Quartz.CGBitmapContextCreate(
            None, width, height, 8, width * 4,
            color_space, Quartz.kCGImageAlphaPremultipliedLast
        )

        # Fill with white background
        Quartz.CGContextSetRGBFillColor(context, 1.0, 1.0, 1.0, 1.0)
        Quartz.CGContextFillRect(context, Quartz.CGRectMake(0, 0, width, height))

        # Scale and draw PDF page
        Quartz.CGContextScaleCTM(context, scale, scale)
        Quartz.CGContextDrawPDFPage(context, page)

        # Create image and save
        image = Quartz.CGBitmapContextCreateImage(context)

        output_path = os.path.join(output_dir, f"page_{page_num:03d}.jpg")
        url = CFURLCreateFromFileSystemRepresentation(None, output_path.encode('utf-8'), len(output_path.encode('utf-8')), False)

        dest = Quartz.CGImageDestinationCreateWithURL(url, "public.jpeg", 1, None)
        Quartz.CGImageDestinationAddImage(dest, image, {Quartz.kCGImageDestinationLossyCompressionQuality: 0.9})
        Quartz.CGImageDestinationFinalize(dest)

        print(f"Saved: {output_path}")

pdf_to_jpeg("$pdf_file", "$output_dir")
EOF

        echo "Converted: $pdf_file -> $output_dir"
    fi
done

# Show notification
osascript -e 'display notification "PDF to JPEG conversion complete!" with title "PDF Converter"'
