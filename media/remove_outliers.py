import numpy as np
import open3d as o3d
from plyfile import PlyData, PlyElement
from sklearn.neighbors import NearestNeighbors
import matplotlib.pyplot as plt

# Method 1: Using Open3D (Recommended - easiest and most robust)
def remove_outliers_open3d(ply_file_path, output_path):
    """
    Remove outliers using Open3D's statistical outlier removal
    """
    # Load point cloud
    pcd = o3d.io.read_point_cloud(ply_file_path)
    
    print(f"Original point cloud has {len(pcd.points)} points")
    
    # Statistical outlier removal
    # nb_neighbors: number of neighbors to consider
    # std_ratio: standard deviation ratio threshold
    pcd_filtered, outlier_indices = pcd.remove_statistical_outlier(
        nb_neighbors=20, 
        std_ratio=2.0
    )
    
    print(f"After filtering: {len(pcd_filtered.points)} points")
    print(f"Removed {len(outlier_indices)} outliers")
    
    # Save filtered point cloud
    o3d.io.write_point_cloud(output_path, pcd_filtered)
    
    return pcd_filtered, outlier_indices

# Method 2: Using radius-based outlier removal (Open3D)
def remove_outliers_radius_open3d(ply_file_path, output_path):
    """
    Remove outliers using radius-based filtering
    """
    pcd = o3d.io.read_point_cloud(ply_file_path)
    
    print(f"Original point cloud has {len(pcd.points)} points")
    
    # Radius outlier removal
    # nb_points: minimum number of points within radius
    # radius: search radius
    pcd_filtered, outlier_indices = pcd.remove_radius_outlier(
        nb_points=16, 
        radius=0.05
    )
    
    print(f"After filtering: {len(pcd_filtered.points)} points")
    print(f"Removed {len(outlier_indices)} outliers")
    
    o3d.io.write_point_cloud(output_path, pcd_filtered)
    
    return pcd_filtered, outlier_indices

# Method 3: Manual outlier removal using distance from centroid
def remove_outliers_manual(ply_file_path, output_path, threshold_multiplier=3.0):
    """
    Remove outliers based on distance from centroid
    """
    # Read PLY file
    with open(ply_file_path, 'rb') as f:
        plydata = PlyData.read(f)
    
    # Extract vertices
    vertices = plydata['vertex']
    x = vertices['x']
    y = vertices['y']
    z = vertices['z']
    
    points = np.column_stack((x, y, z))
    
    # Calculate centroid
    centroid = np.mean(points, axis=0)
    
    # Calculate distances from centroid
    distances = np.linalg.norm(points - centroid, axis=1)
    
    # Calculate threshold (mean + threshold_multiplier * std)
    mean_dist = np.mean(distances)
    std_dist = np.std(distances)
    threshold = mean_dist + threshold_multiplier * std_dist
    
    # Filter points
    mask = distances <= threshold
    filtered_points = points[mask]
    
    print(f"Original points: {len(points)}")
    print(f"Filtered points: {len(filtered_points)}")
    print(f"Removed {len(points) - len(filtered_points)} outliers")
    
    # Create new PLY data
    filtered_vertices = np.array([tuple(point) for point in filtered_points],
                                dtype=[('x', 'f4'), ('y', 'f4'), ('z', 'f4')])
    
    # If original has colors, preserve them
    if hasattr(vertices.dtype, 'names') and vertices.dtype.names and 'red' in vertices.dtype.names:
        colors = np.column_stack((vertices['red'], vertices['green'], vertices['blue']))
        filtered_colors = colors[mask]
        
        filtered_vertices = np.array([tuple(np.concatenate([point, color])) 
                                    for point, color in zip(filtered_points, filtered_colors)],
                                   dtype=[('x', 'f4'), ('y', 'f4'), ('z', 'f4'),
                                         ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')])
    
    # Save filtered PLY
    el = PlyElement.describe(filtered_vertices, 'vertex')
    PlyData([el]).write(output_path)
    
    return filtered_points

# Method 4: Using clustering to remove isolated points
def remove_outliers_clustering(ply_file_path, output_path, eps=0.02, min_samples=10):
    """
    Remove outliers using DBSCAN clustering
    """
    from sklearn.cluster import DBSCAN
    
    # Read PLY file
    with open(ply_file_path, 'rb') as f:
        plydata = PlyData.read(f)
    
    vertices = plydata['vertex']
    points = np.column_stack((vertices['x'], vertices['y'], vertices['z']))
    
    # Apply DBSCAN
    clustering = DBSCAN(eps=eps, min_samples=min_samples).fit(points)
    labels = clustering.labels_
    
    # Find the largest cluster (main object)
    unique_labels, counts = np.unique(labels, return_counts=True)
    # Remove noise label (-1) from consideration
    valid_labels = unique_labels[unique_labels != -1]
    valid_counts = counts[unique_labels != -1]
    
    if len(valid_labels) > 0:
        largest_cluster_label = valid_labels[np.argmax(valid_counts)]
        mask = labels == largest_cluster_label
    else:
        mask = labels != -1  # Just remove noise if no valid clusters
    
    filtered_points = points[mask]
    
    print(f"Original points: {len(points)}")
    print(f"Filtered points: {len(filtered_points)}")
    print(f"Removed {len(points) - len(filtered_points)} outliers")
    
    # Save filtered points (similar to method 3)
    filtered_vertices = np.array([tuple(point) for point in filtered_points],
                                dtype=[('x', 'f4'), ('y', 'f4'), ('z', 'f4')])
    
    el = PlyElement.describe(filtered_vertices, 'vertex')
    PlyData([el]).write(output_path)
    
    return filtered_points

# Usage examples for your specific file
if __name__ == "__main__":
    input_file = "img_143.ply"
    
    # Method 1: Open3D statistical (recommended for your case)
    # This should effectively remove the 3 outlier points
    filtered_pcd, outliers = remove_outliers_open3d(input_file, "img_143_filtered.ply")
    
    # If you want to try other methods:
    
    # Method 2: Manual distance-based (adjust threshold_multiplier if needed)
    # Start with 2.0 and increase if too aggressive, decrease if not removing enough
    filtered_points = remove_outliers_manual(input_file, "img_143_manual.ply", threshold_multiplier=2.0)
    
    # Method 3: Clustering-based (good for your scattered outliers)
    filtered_points2 = remove_outliers_clustering(input_file, "img_143_clustering.ply", eps=0.05, min_samples=15)

# Visualization function to compare before/after
def visualize_results(original_file, filtered_file):
    """
    Visualize original vs filtered point cloud
    """
    # Load both point clouds
    pcd_original = o3d.io.read_point_cloud(original_file)
    pcd_filtered = o3d.io.read_point_cloud(filtered_file)
    
    # Color them differently
    pcd_original.paint_uniform_color([1, 0, 0])  # Red for original
    pcd_filtered.paint_uniform_color([0, 1, 0])  # Green for filtered
    
    # Visualize
    o3d.visualization.draw_geometries([pcd_original, pcd_filtered])
