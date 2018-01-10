<?php
require_once('../../wp-config.php');
require_once('../../wp-includes/wp-db.php');
require_once('./include/api-functions.php');
?>

<?php
	$mediaID = $_POST['mediaID'];
	
	// Increments the number of views a media record has had
	$views = $wpdb->get_var($wpdb->query($wpdb->prepare("CALL get_incident_media_views(%d)", $mediaID)));
	
	// Update the view count in the ES record
	$indexName = 'avw_incident_media';
	$postData = array(
		'script' => array(
			'inline' => ctx._source.Views=$views",
			'lang' => 'groovy'
		)
	);

	$result = apiIndexUpdate($indexName, 'incident_media', $mediaID, $postData);
	
	echo 1;
?>